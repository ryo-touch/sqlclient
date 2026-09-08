# sqlclient

MySQL / PostgreSQLのread-onlyアカウントで使う、Ink製のターミナルSQLクライアントです。接続情報は独自管理せず、MySQLのlogin-pathとPostgreSQLのservice/password fileを読みます。

## 必要なもの

- macOS 26以降
- Bun 1.3.14以降
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

schemaを選択するとHeaderにschema名が表示されます。table一覧はcatalogで `l` または右矢印を押したschemaだけ、`▾` の下に表示されます。

tableを開いた結果では、Headerのbreadcrumb末尾にtable名も表示します。任意SQLの結果では誤認を避けるためtable名を表示しません。

## キーバインド

| Key             | 動作                                       |
| --------------- | ------------------------------------------ |
| `j` / `k`, 矢印 | 上下移動                                   |
| `h` / `l`       | catalogの折りたたみ／展開、resultの列移動  |
| `g` / `G`       | 先頭 / 末尾                                |
| `Enter`         | 接続・schemaを選んでqueryへ移動・table表示 |
| `Tab`           | catalog → result → queryを巡回             |
| `Shift+Tab`     | query内のfocusを逆順に切り替える           |
| `e`             | 左側のSQL editorを開く                     |
| `Cmd+Enter`     | editorのSQLを実行                          |
| `Ctrl-G`        | editorのSQLを外部エディタで編集            |
| `Ctrl-Space`    | table名・column名を補完                    |
| `Ctrl-X`        | 接続先の選択画面を開く                     |
| `Ctrl-R`        | 現在の接続先へ再接続                       |
| `s`             | catalogのsystem schema表示を切り替える     |
| `r`             | 直近または選択中のクエリを再実行           |
| `n` / `p`       | table結果の次 / 前ページ                   |
| `y`             | 選択セルまたはtable名を `pbcopy` へコピー  |
| `w`             | 現在のresultをTSVファイルへ書き出す        |
| `/`             | 大文字小文字を区別しないフィルタ           |
| `?`             | help                                       |
| `q` / `Esc`     | 一つ前へ戻る。connectionsでは終了          |
| `Ctrl-C`        | 実行中クエリを中断                         |

クエリ履歴は新しい順に最大500件を `~/.config/sqlclient/history.jsonl` へ0600で保存します。

resultで `w` を押すと、保持中の列名と全行をカレントディレクトリの `sqlclient-result-YYYYMMDD-HHmmss.tsv` へ書き出します。既存ファイルは上書きせず、同名の場合は連番を付けます。`NULL` は空欄、タブ・改行・ダブルクォートを含む値はダブルクォートで囲みます。

接続中に `Ctrl-X` を押すと接続一覧へ移動し、現在の接続は `active` と表示されます。別の接続が成功してから元のsessionを閉じるため、接続失敗時は元の接続とSQL draftを維持します。`Esc` で切り替えを中止できます。`Ctrl-R` は現在の接続設定を再解決してsessionを作り直します。

### SQL editorとresult

connectionsで接続先を選んで `Enter` を押すとcatalogへ移動します。schemaを選んで `Enter` を押すと、そのschemaを接続の既定値に設定してquery画面へ進みます。tableを確認したい場合だけ、catalogでschemaにカーソルを合わせて `l` または右矢印を押すとtable一覧を読み込みます。`h` または左矢印で折りたためます。

query画面の左側で複数行SQLを編集でき、右側には直近のresultが残るため、SQLと結果を同時に確認できます。通常の `Enter` は改行、macOSの `Cmd+Enter` はSQL実行です。`Tab` でeditor → result → history、`Shift+Tab` で逆順にfocusを切り替えます。

editorにfocusして `Ctrl-G` を押すと、現在のSQLを一時的な `.sql` ファイルへ書き出し、外部エディタで編集できます。`VISUAL`、次に `EDITOR` の順で環境変数を参照します。`code --wait` のように、エディタ名と引数をまとめて設定できます。保存してエディタを閉じると編集結果がSQL draftへ戻り、一時ファイルは削除されます。

`Ctrl-Space` はcursor直前の識別子を、選択中schemaのtable名・column名から大文字小文字を区別せず補完します。候補が複数ある場合は共通prefixまで入力し、候補をstatusへ表示します。metadataはschemaごとに初回だけ取得します。この取得中はクエリ実行と同じ扱いになり、経過時間が表示されて `Ctrl-C` で中断できます。

端末の高さが28行未満、または履歴が空の場合はHistory paneを隠し、その高さをSQL editorへ割り当てます。Historyが非表示のときは `Tab` / `Shift+Tab` の移動対象からも除外します。

## 既知の制約

- table閲覧は1ページ200行です。次ページ判定用に201行を取得し、余剰1行は保持しません。
- 任意SQLは意味を変えないため自動で `LIMIT` を追加しません。stateと画面には最大2000行だけを残しますが、Bun.SQL 1.4にはstreaming / maxRows APIがないため、返却時に全結果が一時的にメモリへ載る可能性があります。巨大な結果にはSQL側で `LIMIT` を指定してください。
- Bun.SQLは空結果のcolumn metadataを公開しないため、0行の任意SQLではcolumn名を表示できません。重複したcolumn名もオブジェクト結果で最後の値が優先されます。
- MySQL 8.4 Dockerの `caching_sha2_password` はBun 1.4.0とのローカル非TLS接続で認証できなかったため、下記の動作確認では検証用ユーザーだけ `mysql_native_password` を使用しました。非loopback接続でRSA公開鍵取得を自動許可することはありません。

## 動作確認

2026-09-04に以下を確認しました。

- macOS 26 / Bun 1.3.14、1.4.0 / Node 24.15.0
- `bun test`、TypeScript strictのtypecheck、Prettier check
- `bun build --compile src/index.tsx --outfile sqlclient` でarm64 Mach-Oバイナリを生成し、connections一覧を表示
- MySQL stagingのlogin-path経由で接続し、schema / table、table結果を表示
- MySQL 8.4 DockerとPostgreSQL 17 Dockerを同時に一覧表示し、両方へ接続
- 両Dockerの405行tableで200 / 200 / 5行のページングを確認
- Ink内の左editorで複数行SQLを編集し、`Cmd+Enter` 後も右resultと同時表示されることを確認
- 両Dockerで実行中クエリのserver-side cancelを確認
- `NULL` がdim表示され、文字列 `"NULL"` が通常表示されることを確認
- 接続情報のpasswordがconnections、Header、catalog、result、query、errorのいずれにも表示されないことを確認

検証用Dockerコンテナと一時資格情報ファイルは確認後に削除しています。production DBではschema参照だけを行い、書き込みやtable dataの取得は行っていません。

## ライセンス

[MIT License](LICENSE)
