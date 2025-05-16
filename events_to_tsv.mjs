"use strict";
import Database from "better-sqlite3";
import { getProperty } from "dot-prop";
import papaparse from "papaparse";

const db = new Database("storage/sqlite.db");

function help() {
  console.error("`node events_to_tsv.mjs` に続けて events テーブルの data カラムから抽出したいデータのパスをドット記法で引数を指定してください。");
  console.error("例: node events_to_tsv.mjs id received_at exceptions[0].errorClass exceptions[0].message context unhandled app.releaseStage app.type");
  console.error("１つ目の引数に数値だけを入力したらその行数だけで中断できるのでドット記法を試す時に指定すると良い。");
  console.error(". だけを指定するとJSONで全取得になる。");
}

function outputRow(row) {
  console.log(
    papaparse.unparse(
      [
        row.map((cell) => typeof cell === "string" ? cell : JSON.stringify(cell, null, 4))
      ],
      { delimiter: "\t", quotes: true }
    )
  );
}

function main(dotNotations) {
  if (!(dotNotations instanceof Array)) {
    help();
    return;
  }

  let query = "SELECT data FROM events ORDER BY id ASC";
  if (!isNaN(dotNotations[0])) {
    query += " LIMIT " + dotNotations.shift();
  }

  if (!(dotNotations instanceof Array) || dotNotations.length === 0) {
    help();
    return;
  }

  outputRow(dotNotations);

  for (const { data } of db.prepare(query).iterate()) {
    if (dotNotations[0] === ".") {
      outputRow([JSON.parse(data)]);
    } else {
      outputRow(dotNotations.map((path) => getProperty(JSON.parse(data), path, null)));
    }
  }
}

main(process.argv.slice(2));
