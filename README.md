# sqlclient

MySQL / PostgreSQLのread-onlyアカウントで使う、Ink製のターミナルSQLクライアントです。接続情報は独自管理せず、MySQLのlogin-pathとPostgreSQLのservice/password fileを読みます。

## 必要なもの

- macOS 26以降
- Bun 1.4以降
- MySQLを使う場合は `my_print_defaults` と `mysql_config_editor`

## インストールと起動

```bash
bun install
bun run src/index.tsx
```

単一バイナリは次のコマンドで生成できます。

```bash
bun build --compile src/index.tsx --outfile sqlclient
./sqlclient
```

## 接続の用意

### MySQL

既存のlogin-pathを `~/.mylogin.cnf` に用意します。アプリは `mysql_config_editor print --all` で名前だけを列挙し、選択された接続だけを `my_print_defaults` で解決します。

```bash
mysql_config_editor set \
  --login-path=example-staging \
  --host=db.example.test \
  --port=3306 \
  --user=reader \
  --password
```

検証用に別ファイルを使う場合は `MYSQL_TEST_LOGIN_FILE` を指定できます。アプリが `.mylogin.cnf` を作成・変更することはありません。

接続名による環境制限はありません。production用login-pathも一覧に表示されるため、必ずDB側でread-only権限を設定した専用アカウントを使ってください。

### PostgreSQL

`~/.pg_service.conf` に接続先を定義します。

```ini
[example-staging]
host=db.example.test
port=5432
user=reader
dbname=example
```

必要なら `~/.pgpass` にパスワードを置き、他ユーザーから読めないようにします。

```text
db.example.test:5432:example:reader:password
```

```bash
chmod 600 ~/.pgpass
```

標準の `PGSERVICEFILE` / `PGPASSFILE` で読み取り先を変更できます。service fileが無い場合は `PGHOST` / `PGPORT` / `PGUSER` / `PGDATABASE` から1接続を組み立てます。`PGPASSWORD` は読みません。

## 書き込み防止の前提

このアプリはSQLを解析・制限せず、入力されたSQLをそのままDBへ送ります。書き込み防止はDBアカウントの権限で行う設計です。MySQLのlogin-pathとPostgreSQLのserviceには、対象schema/tableへの参照権限だけを持つ専用アカウントを設定してください。

書き込み権限を持つアカウントで接続した場合、`INSERT` / `UPDATE` / `DELETE` / DDLも実行されます。アプリ側の表示や接続名は安全性の保証にはなりません。

catalogでschemaを `Enter` すると、そのschemaを現在の接続の既定schemaにも設定します。以降は `SELECT * FROM table_name` のようにschema名を省略したSQLも、選択中のschemaに対して実行されます。

schemaが `▾` で展開され、Headerにschema名が表示されていれば選択済みです。その状態でcatalogのどこからでも `e` を押すとSQL workbenchへ移動します。

tableを開いた結果では、Headerのbreadcrumb末尾にtable名も表示します。任意SQLの結果では誤認を避けるためtable名を表示しません。

展開中のschema見出しで再度 `Enter` を押すとtable一覧を折りたためます。折りたたみ後は `j` / `k` で隣のschemaへ直接移動できます。

## キーバインド

| Key             | 動作                                      |
| --------------- | ----------------------------------------- |
| `j` / `k`, 矢印 | 上下移動                                  |
| `h` / `l`       | catalogのペイン移動、resultの列移動       |
| `g` / `G`       | 先頭 / 末尾                               |
| `Enter`         | 接続・schema展開・table表示・履歴再実行   |
| `Tab`           | catalog → result → queryを巡回            |
| `Shift+Tab`     | query内のfocusを逆順に切り替える          |
| `e`             | 左側のSQL editorを開く                    |
| `Cmd+Enter`     | editorのSQLを実行                         |
| `r`             | 直近または選択中のクエリを再実行          |
| `n` / `p`       | table結果の次 / 前ページ                  |
| `y`             | 選択セルまたはtable名を `pbcopy` へコピー |
| `/`             | 大文字小文字を区別しないフィルタ          |
| `?`             | help                                      |
| `q` / `Esc`     | 一つ前へ戻る。connectionsでは終了         |
| `Ctrl-C`        | 実行中クエリを中断                        |

クエリ履歴は新しい順に最大500件を `~/.config/sqlclient/history.jsonl` へ0600で保存します。

### SQL editorとresult

`e` を押すとInk内の分割画面へ移り、左側で複数行SQLを編集できます。右側には直近のresultが残るため、SQLと結果を同時に確認できます。通常の `Enter` は改行、macOSの `Cmd+Enter` はSQL実行です。`Tab` でeditor → result → history、`Shift+Tab` で逆順にfocusを切り替えます。

## 既知の制約

- table閲覧は1ページ200行です。次ページ判定用に201行を取得し、余剰1行は保持しません。
- 任意SQLは意味を変えないため自動で `LIMIT` を追加しません。stateと画面には最大2000行だけを残しますが、Bun.SQL 1.4にはstreaming / maxRows APIがないため、返却時に全結果が一時的にメモリへ載る可能性があります。巨大な結果にはSQL側で `LIMIT` を指定してください。
- Bun.SQLは空結果のcolumn metadataを公開しないため、0行の任意SQLではcolumn名を表示できません。重複したcolumn名もオブジェクト結果で最後の値が優先されます。
- MySQL 8.4 Dockerの `caching_sha2_password` はBun 1.4.0とのローカル非TLS接続で認証できなかったため、下記の動作確認では検証用ユーザーだけ `mysql_native_password` を使用しました。非loopback接続でRSA公開鍵取得を自動許可することはありません。

## 動作確認

2026-09-04に以下を確認しました。

- macOS 26 / Bun 1.4.0 / Node 24.15.0
- `bun test`、TypeScript strictのtypecheck、Prettier check
- `bun build --compile src/index.tsx --outfile sqlclient` でarm64 Mach-Oバイナリを生成し、connections一覧を表示
- MySQL stagingのlogin-path経由で接続し、schema / table / column、table結果を表示
- MySQL 8.4 DockerとPostgreSQL 17 Dockerを同時に一覧表示し、両方へ接続
- 両Dockerの405行tableで200 / 200 / 5行のページングを確認
- Ink内の左editorで複数行SQLを編集し、`Cmd+Enter` 後も右resultと同時表示されることを確認
- 両Dockerで実行中クエリのserver-side cancelを確認
- `NULL` がdim表示され、文字列 `"NULL"` が通常表示されることを確認
- 接続情報のpasswordがconnections、Header、catalog、result、query、errorのいずれにも表示されないことを確認

検証用Dockerコンテナと一時資格情報ファイルは確認後に削除しています。production DBではschema参照だけを行い、書き込みやtable dataの取得は行っていません。
