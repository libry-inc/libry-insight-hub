"use strict";
import axios, { AxiosError } from "axios";
import Database from "better-sqlite3";
import { configDotenv } from "dotenv";

configDotenv();

const BUGSNAG_PROJECT_ID = process.env.BUGSNAG_PROJECT_ID;
const BUGSNAG_API_TOKEN = process.env.BUGSNAG_API_TOKEN;
const MAX_PER_PAGE = 30; // max 30
const headers = {
  Authorization: `token ${BUGSNAG_API_TOKEN}`,
  "Content-Type": "application/json",
};
const db = new Database("storage/sqlite.db");
["errors", "events"].forEach((table) => {
  db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, timestamp INTEGER, data TEXT)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS ${table}_timestamp_index ON ${table} (timestamp)`).run();
});

async function fetchAndSave(url, table, timestampColumn, callback) {
  let remaining = Infinity;

  while (remaining > 0) {
    let response = null;

    do {
      try {
        console.log("axios.get:", url, remaining);
        response = await axios.get(url, { headers });

        if (response.data.length === 0) {
          break;
        }
      } catch (error) {
        if (!(error instanceof AxiosError) || error.response === undefined || error.response.status !== 429) {
          console.error("Error on fetching:", error);
          return;
        }

        const sec = parseInt(error.response.headers["retry-after"]) || 59;
        console.log(`Too Many Requests. retry after ${sec} sec.`);
        await new Promise(r => setTimeout(r, (sec + 1) * 1000));
      }
    } while (response === null);

    if (callback(response.data) === false) {
      break;
    }

    try {
      const bindings = [];
      for (const record of response.data) {
        bindings.push(record.id, (new Date(record[timestampColumn])).getTime(), JSON.stringify(record));
      }
      const values = Array.from({ length: response.data.length }).fill("(?, ?, ?)");
      db.prepare(`INSERT OR IGNORE INTO ${table} (id, timestamp, data) VALUES ${values.join(", ")}`).run(...bindings);
    } catch (error) {
      console.error("Error on saving:", error);
      break;
    }

    if (response.data.length < MAX_PER_PAGE) {
      break;
    }

    remaining = Math.min(remaining - response.data.length, parseInt(response.headers["x-total-count"]) || Infinity);
    url = decodeURIComponent(((response.headers.link || "").match(/^<([^>]+)>/) || [])[1] || "");

    if (url === "") {
      console.error("next link is invalid:", response.headers.link);
      break;
    }
  }
}

async function main(command) {
  let query = `?per_page=${MAX_PER_PAGE}&full_reports=true`;

  switch (command) {
    case "asc":
    case "desc":
      query += `&direction=${command}`;
  }

  await fetchAndSave(
    `https://api.bugsnag.com/projects/${BUGSNAG_PROJECT_ID}/events${query}`,
    "events",
    "received_at",
    (data) => {
      const ids = data.map((record) => record.id);
      const params = ids.map(() => "?").join(", ");
      const count = db.prepare(`SELECT COUNT(1) FROM events WHERE id IN(${params})`).pluck().get(...ids);

      if (count === MAX_PER_PAGE) {
        console.log("取得データが全て保存済みのため終了");

        return false;
      }
    },
  );
  // MEMO: errors を軸にデータを取得しても errors 自体の分類が低品質だと使い物にならない印象
  // await fetchAndSave(
  //   `https://api.bugsnag.com/projects/${BUGSNAG_PROJECT_ID}/errors?per_page=${MAX_PER_PAGE}`,
  //   "errors",
  //   "last_seen",
  //   () => true,
  // );
  // for (const { id } of db.prepare("SELECT id FROM errors ORDER BY id ASC").all()) {
  //   await fetchAndSave(
  //     `https://api.bugsnag.com/projects/${BUGSNAG_PROJECT_ID}/errors/${id}/events?per_page=${MAX_PER_PAGE}&include=${includes.join(",")}`,
  //     "events",
  //     "received_at",
  //     // TODO: 時間がものすごくかかるようなら、取得済みのデータを取らなくて良いようになにかロジック組む
  //     () => true,
  //   );
  // }
}

main(process.argv[2]);
