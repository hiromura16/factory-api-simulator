"use strict";

(() => {
  function field(path, label, type, options = {}) {
    return { path, label, type, ...options };
  }

  function choices(labels) {
    return Object.entries(labels).map(([value, label]) => ({ value, label }));
  }

  const generatorOptions = choices({
    record_id: "一意のレコードID", uuid: "UUID", sequence: "連番",
    integer: "ランダムな整数", uniform: "一様乱数", normal: "正規分布",
    choice: "候補から選択", boolean: "真偽値", constant: "固定値",
    template: "テンプレート", timestamp: "時刻", reference: "別の項目を参照",
    sum: "合計", difference: "差", product: "積", ratio: "比率",
  });

  const anomalyOptions = choices({
    set: "値の置き換え", add: "加算", multiply: "乗算", ramp: "段階変化",
    freeze: "値の固定", null: "欠損値", copy_from: "別項目からコピー",
    timestamp_shift: "時刻のずれ", omit: "項目を省略",
  });

  function generationSections(prefix) {
    return [
      {
        title: "データ項目と再現性",
        description: "同じシードと設定で同じ合成値を得られます。生成方式ごとの細かい条件はJSONで調整できます。",
        fields: [
          field(prefix + "run_key", "生成の識別子", "text", {
            help: "連番や一意IDの基準です。プリセットの保存IDとは別に指定します。",
          }),
          field(prefix + "seed", "乱数シード", "integer", { min: 0, max: 2147483647, default: 42 }),
          field(prefix + "parameters", "共通パラメーター", "json", {
            help: "JSONオブジェクトで定義します。対応する生成条件から $パラメーター名 で参照できます。",
          }),
          field(prefix + "fields", "生成する項目", "table", {
            default: { name: "new_field", data_type: "string", generator: "constant", value: "" },
            columns: [
              field("name", "項目名", "text"),
              field("data_type", "データ型", "select", {
                options: choices({
                  string: "文字列", integer: "整数", number: "数値", decimal: "小数",
                  boolean: "真偽値", datetime: "日時", json: "JSON",
                }),
              }),
              field("generator", "生成方式", "select", { options: generatorOptions }),
              field("template", "テンプレート", "text", {
                help: "テンプレート方式で参照できる例は {sequence} です。",
              }),
              field("value", "固定値（JSON）", "json"),
            ],
          }),
        ],
      },
      {
        title: "データの異常ルール",
        description: "対象の値を変える条件を追加します。位置は0始まりです。条件式や終了位置はJSONで調整できます。",
        fields: [
          field(prefix + "anomalies", "異常ルール", "table", {
            default: { field: "", operation: "null", from_row: 0, every: 1, enabled: true },
            columns: [
              field("enabled", "有効", "boolean", {default: true}),
              field("field", "対象項目", "text"),
              field("operation", "変更方法", "select", { options: anomalyOptions }),
              field("from_row", "開始位置", "integer", { min: 0, max: 100000000 }),
              field("every", "何件ごと", "integer", { min: 1, max: 100000000 }),
              field("value", "値（JSON）", "json"),
            ],
          }),
        ],
      },
    ];
  }

  const faultOptions = choices({
    none: "なし", rate_limit: "429 · レート制限", server_error: "503 · サービス障害",
    unauthorized: "401 · 認証エラー", delay: "応答遅延", duplicate_page: "ページの重複",
    skip_page: "ページの欠落", truncate_json: "途中で途切れたJSON",
    cursor_expired: "410 · カーソルの期限切れ",
  });

  function summarize(spec, preview) {
    const business = spec?.business || {};
    const resources = Array.isArray(business.resources) ? business.resources : [];
    const count = resources.reduce((sum, resource) =>
      Number.isFinite(resource?.rows) && resource.rows > 0 ? sum + resource.rows : sum, 0);
    const number = new Intl.NumberFormat("ja-JP");
    const rows = resources.length
      ? [{ label: "初期データ", value: number.format(resources.length) + " コレクション／" + number.format(count) + " 件" }]
      : [];
    const first = resources[0];
    if (typeof first?.name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(first.name)) {
      const size = business.page_size ?? 100;
      const limit = first.rows;
      rows.push({
        label: "先頭コレクションの取得例",
        value: "GET /source/rest/" + first.name + " ／ GET /source/odata/" + first.name,
      });
      if (Number.isInteger(size) && size > 0 && Number.isInteger(limit) && limit > 0) {
        const pageCount = Math.ceil(limit / size);
        const slots = ["1ページ目: 1〜" + Math.min(size, limit)];
        if (pageCount > 2) slots.push("2ページ目: " + (size + 1) + "〜" + Math.min(2 * size, limit));
        if (pageCount > 1) slots.push("最終ページ: " + ((pageCount - 1) * size + 1) + "〜" + limit);
        rows.push({
          label: first.name + " のページ配分（初期値・既定ページサイズ）",
          value: number.format(pageCount) + " ページ／" + slots.join("、"),
        });
      }
    }
    if (business.fault && business.fault !== "none") {
      const label = faultOptions.find((option) => option.value === business.fault)?.label;
      const every = Number.isInteger(business.fault_every) ? business.fault_every : 5;
      if (label) {
        rows.push({
          label: "障害の再現",
          value: label + "（" + every + " リクエストごと）",
        });
      }
    }

    const plan = preview?.request_preview;
    if (!plan) return rows;
    rows.push({
      label: "公開プロファイル",
      value: plan.profile.available
        ? plan.profile.profile_id + "（版 " + plan.profile.revision + "）／"
          + (plan.profile.header_example || "取得時の認証なし") + "／"
          + (plan.profile.writes_allowed ? "編集用APIの許可あり" : "取得専用")
        : "未登録の参照先です",
    });
    for (const resource of plan.resources.slice(0, 4)) {
      rows.push({
        label: resource.name + " の取得例",
        value: plan.method + " " + resource.rest_path + " ／ " + plan.method + " " + resource.odata_path,
      });
    }
    rows.push({
      label: "ページ・差分リンク",
      value: "カーソルは " + plan.cursor_ttl_seconds + " 秒有効。応答の next または @odata.nextLink をたどり、最後の応答の delta または @odata.deltaLink を保存します。",
    });
    rows.push({ label: "ODataの型情報", value: "GET " + plan.metadata_path });
    const record = preview.records?.[0];
    if (record) {
      const sample = JSON.stringify(record);
      rows.push({
        label: "共通生成設定の合成レコード",
        value: sample.length > 650 ? sample.slice(0, 650) + "…" : sample,
      });
    }
    return rows;
  }

  window.FactoryPresetConfig = {
    title: "業務APIプリセット",
    description: "コレクション、ページ送り、差分取得と応答障害を設定します。見本からREST／ODataの取得パスを確認できます。",
    summarize,
    sections: [
      {
        title: "公開プロファイルとコレクション",
        description: "認証方式と取得専用・編集用APIの許可は公開プロファイルで指定します。この画面の保存ではAPIの公開を始めません。",
        fields: [
          field("profile_id", "公開プロファイル", "connection", { default: "default" }),
          field("business.resources", "公開するコレクション", "table", {
            default: { name: "new_resource", rows: 200, generator: null },
            help: "同じ名前は使えません。名前は英数字と下線を使用し、英字か下線で始めます。",
            columns: [
              field("name", "コレクション名（URL末尾）", "text", { placeholder: "orders" }),
              field("rows", "初期件数", "integer", { min: 1, max: 1000000, default: 200 }),
              field("generator", "専用データ定義（JSON）", "json", {
                help: "空欄またはnullで共通のデータ定義を使用。特定のコレクションのみ内容を変えるときに指定します。",
              }),
            ],
          }),
        ],
      },
      {
        title: "ページングと差分",
        description: "RESTと一部のOData 4.0クエリ（$filter、$orderby、$selectなど）を試せます。次ページと差分のURLは応答のリンクを使います。",
        fields: [
          field("business.page_size", "既定ページサイズ", "integer", { min: 1, max: 1000, default: 100 }),
          field("business.cursor_ttl_seconds", "カーソルの有効時間（秒）", "integer", {
            min: 1, max: 86400, default: 600, help: "期限を過ぎると取得をやり直す必要があります。",
          }),
          field("interval_ms", "更新間隔（ms）", "integer", { min: 10, max: 60000, default: 1000 }),
          field("business.updates_per_tick", "1回に更新する最大件数", "integer", {
            min: 0, max: 10000, default: 2, help: "各コレクションの上限です。0は更新なし。",
          }),
          field("business.delete_every_ticks", "何回ごとに削除を再現するか", "integer", {
            min: 0, default: 0, help: "0は削除なし。差分APIで削除済みレコードの処理を試せます。",
          }),
          field("max_ticks", "更新回数の上限", "integer", {
            min: 0, max: 100000000, default: 0, help: "0は回数制限なし。",
          }),
          field("storage_limit_mb", "保存容量の上限（MiB）", "integer", { min: 16, max: 102400, default: 1024 }),
        ],
      },
      {
        title: "取得時の障害を再現",
        description: "受け手のリトライや再同期を試す設定です。見本の表示ではこの障害を発生させません。",
        fields: [
          field("business.fault", "応答障害", "select", { default: "none", options: faultOptions }),
          field("business.fault_every", "何リクエストごとに起こすか", "integer", {
            min: 1, default: 5,
            when: { path: "business.fault", equals: faultOptions.slice(1).map((option) => option.value) },
          }),
          field("business.fault_delay_ms", "応答遅延（ms）", "integer", {
            min: 0, max: 10000, default: 1000, when: { path: "business.fault", equals: "delay" },
          }),
        ],
      },
      ...generationSections("generator."),
    ],
  };
})();
