# 業務API模擬 / MES・ERP・在庫

指図・在庫・独自コレクションをSQLiteに実際に保存し、取得側の定期収集を試験するサーバーです。

| パス | 内容 |
| --- | --- |
| `/source/rest/orders?limit=50` | 固定snapshotでページング。`next`をそのまま取得 |
| `/source/rest/orders/{id}` | 単件取得とETag / If-None-Match |
| 最終ページの`delta`リンク | 更新・削除の差分。返されたリンクをそのまま利用 |
| `/source/odata/orders` | `$top/$skip/$skiptoken/$filter/$orderby/$select` |
| `/source/odata/$metadata` | XMLメタデータ |

検索例: `$filter=quantity ge 10 and status eq 'running'`。比較eq/ne/gt/ge/lt/le、and/or、括弧をサポート。任意式やSQLは実行しません。REST側は`filter/order_by/select`で同じ指定が可能です。

公開プロファイルのallow_writesを有効にするとRESTのPOST/PATCH/DELETEを許可。PATCH/DELETEはIf-Matchで競合を検出します。生成器も同じ疑似データを更新するため、固定したい場合はupdates_per_tick=0にしてください。初期化は500件単位で再開位置を保存します。

429＋Retry-After、503、401、遅延、重複/欠落ページ、途中切れJSON、カーソル失効を再現。故障カウンターは取得APIだけを対象にします。ODataは上記のサブセットであり、完全なOData準拠・SAP/Dynamicsの互換実装ではありません。カーソル失効時は全件再同期が必要です。

## カスタマイズと使い方

1. 「公開・配送プロファイル」で方式・認証・接続先を保存。
2. 「設定と実行」でプリセットを読み込み、任意項目・型・生成器・異常ルールと個別設定を編集。
3. 項目にマウスを重ねるか「?」にフォーカスすると、その場で説明を表示。「プレビュー」は通信・書き込みを行いません。
4. 停止してから開始すると新しい設定を適用。実行中は設定とプロファイルの版を固定します。
5. 「この設定を保存…」からJSONを編集・検証・取り込み・書き出し・プリセット保存できます。

24種類（通常12・異常12）のJSONを同梱。[一覧と詳細](presets/README.md)には想定・生成条件・確認事項を記載しています。再生成は`uv run python build_presets.py`。初回起動で未登録IDだけを追加し、保存済み設定は更新で上書きしません。

データ型はstring/integer/number/decimal/boolean/datetime/json。record_id、uuid、sequence、分布、重み付きchoice、テンプレート、参照、四則演算、時刻、NULL率、条件上書き、固着・ドリフト・欠落等を指定できます。共有パラメーターは`$名前`、テンプレートでは先行項目を参照。任意Pythonは実行しません。異常ルールの生成位置は各ドライバーが使う論理sequenceであり、必ずしもtickやAPIの読取順ではありません。

公開契約は[Spec JSON Schema](contracts/spec.schema.json)と[Profile JSON Schema](contracts/profile.schema.json)。Spec.version=1、内包するgeneratorは既存ツールと同じRunSpec.version=2です。SQL/ファイル/ストリーム専用の一部設定は内包モデルに残っていますが、このツールのフォームでは使う項目だけを表示します。

## 起動

Python 3.12、uv、Docker Composeを使用します。

```sh
uv sync --frozen
uv run python scripts/init_local.py --env-file .env
docker compose up -d --build
```

`.env`のAPP_PORTが画面のポート、BIND_IPは既定127.0.0.1。管理画面と操作APIはログイン不要です。直接起動する場合:

```sh
DATA_DIR="$PWD/data" AUTO_START=1 uv run uvicorn app:app --host 127.0.0.1 --port 8080 --workers 1
```

1アプリ1プロセス・1実行。AUTO_START=1は初回に既定プリセットを開始。その後は保存済みの停止・実行状態を復元します。Docker再作成後もnamed volumeへ設定・データを保持。初期設定は小規模で、速度は保証値ではありません。interval_ms、batch_size、タグ/設備/件数等を増やす場合も、CPU・メモリ・容量上限を合わせて設定してください。

## 認証・データと運用

管理画面と`/api/*`はログイン不要。取得用`/source/*`の認証はプロファイルでnone/basic/bearer/api_key（X-API-Key）から別途選択します。APIへの変更操作は同一オリジンとapplication/jsonを要求。`/healthz`と`/metrics`も認証不要です。暗号化HTTPが必要な経路では既存のTLS終端を使用してください。

秘密情報はFernetで暗号化保存し、読み戻し・JSON書き出しから除外。同じ接続範囲なら未入力の資格情報を保持し、接続範囲が変われば引き継ぎません。clear_secretsで明示削除できます。証明書・秘密鍵・CAは画面からconnection-filesへ権限600で配置可能。

DATA_DIRにはsettings.sqlite3、source.key、connection-files、永続データを保存します。DBと暗号鍵は一緒にバックアップし、秘密情報として管理してください。暗号鍵だけを失うと復号できません。リポジトリへ認証情報・実行データは含めません。

ホストメモリ余力（既定6GiB）、ディスク余力2GiB、storage_limit_mbを監視し、閾値で生成を停止します。Composeは既定512MiB/1CPU、非root、read-only root、ログ上限、ホスト側の負荷ガード連携用ラベルを設定。`storage_limit_mb`はDATA_DIR配下の上限で、別マウントのログはローテーションで制限します。

`uv run pytest -q`と`uvx ruff check .`で検証。[検証記録](VALIDATION.json)に実接続と画面確認の範囲を記載しています。loopbackを既定とする汎用的な配置例と、他ソースとの組み合わせは[構成例](docs/architecture.md)を参照してください。特定環境の接続情報ではありません。

## 外部監視用の管理ラベル

Composeの管理ラベルは既定で `factory.guard.managed=true` です。外部監視側との合意が必要な場合は、非公開の配備設定で `FACTORY_GUARD_LABEL_PREFIX` を指定できます。例えば説明用の値 `synthetic-guard` を指定すると、`synthetic-guard.guard.managed=true` になります。

既存の外部監視との互換性は未確認です。変更前に監視側が照合するラベル名と影響を確認してください。この設定は既存コンテナや監視設定を自動移行せず、デプロイも行いません。
