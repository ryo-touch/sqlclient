# sqlclient 実装指示書

このファイルは Claude Code / Codex への実装依頼書である。プロジェクト直下に置き、ここに書かれた仕様と手順に従って `sqlclient` を最後まで実装すること。判断に迷った場合は「既定の判断」の節を優先し、それでも決められない場合のみ質問する。

## 概要

MySQL / PostgreSQL に参照専用で接続し、スキーマとテーブルを辿りながら、任意の SQL を書いて結果を確認できるターミナルアプリ。

- 利用者は開発者本人のみ。ローカルで動けばよい
- Bun + TypeScript + Ink で実装する
- **参照専用**。書き込みはアプリの機能として持たず、サーバ側のセッション設定で禁止する
- 資格情報はアプリで管理しない。MySQL は `.mylogin.cnf` の login-path、PostgreSQL は `.pg_service.conf` と `.pgpass` という各 DB の標準ストアをそのまま読む

## 成果物

- `bun run src/index.tsx` で起動するアプリ
- `bun build --compile` で生成できる単一バイナリ `sqlclient`
- README（起動方法、接続の用意、キーバインド、既知の制約）
- `core/` のユニットテスト

## 環境前提

- macOS 26 以降
- Bun 1.4 以降
- MySQL を使う場合: `my_print_defaults`（Homebrew の `mysql-client@8.4` に同梱）が使えること
- PostgreSQL を使う場合: `~/.pg_service.conf` または環境変数で接続先が解決できること

## 技術スタック

- ランタイム: Bun
- 言語: TypeScript（strict）
- UI: Ink 7、React 19
- DB 接続: **`Bun.SQL`**（`mysql://` と `postgres://` の両方を扱える。追加のドライバは入れない）
- SQL ハイライト: `sql-highlight`
- プロセス実行: `Bun.spawn`
- テスト: `bun test`

依存パッケージは上記以外を原則追加しない。必要になった場合は理由をコミットメッセージに書く。

## スコープ

対象

- 接続一覧の表示と選択（MySQL の login-path / PostgreSQL の service）
- カタログ閲覧: スキーマ → テーブル → カラム
- テーブルのデータ閲覧（自動生成の SELECT、ページング）
- 任意 SQL の実行（Ink 内の SQL editor と result を左右に同時表示する）
- 結果グリッドの表示、横スクロール、セル値のコピー
- クエリ履歴

対象外（実装しない）

- INSERT / UPDATE / DELETE / DDL、およびそれらを実行しうる経路
- 接続情報の新規登録・編集（既存の標準ストアを読むだけ）
- SQLite、その他の RDBMS
- SSH トンネル
- IDE 相当の補完・診断・formatting
- 結果の CSV / JSON エクスポート（v2 以降で検討）

## ディレクトリ構成

```
sqlclient/
  src/
    index.tsx            エントリポイント。render(<App />)
    app.tsx              モード切り替えとキーバインド
    state.ts             reducer と Action 型
    types.ts             型定義
    core/
      credentials.ts     login-path / .pgpass / .pg_service.conf の解決
      connection.ts      Bun.SQL のラップ。接続直後に read-only を強制する
      catalog.ts         スキーマ・テーブル・カラムの取得
      query.ts           クエリ実行、ページング、結果の正規化
      query-editor.ts    複数行編集と cursor 操作の純粋関数
      history.ts         クエリ履歴の永続化
      highlight.ts       sql-highlight のラップと方言補正
      clipboard.ts       pbcopy
      dialect/
        index.ts         Dialect インタフェース
        mysql.ts
        postgres.ts
    ui/
      Header.tsx
      ConnectionList.tsx
      CatalogTree.tsx
      ResultGrid.tsx
      QueryWorkbench.tsx
      StatusBar.tsx
      FilterInput.tsx
      Help.tsx
    util/
      exec.ts            Bun.spawn の薄いラッパ
      format.ts          列幅調整、値の表示整形
  test/
    credentials.test.ts
    dialect.test.ts
    highlight.test.ts
    query.test.ts
    fixtures/
  README.md
  package.json
  tsconfig.json
```

`ui/` は `core/` を直接呼ばず、`state.ts` 経由でデータを受け取る。`core/` は Ink と React に依存しない。この分離は UI ライブラリを差し替え可能に保つためでもある。

## 型定義

`src/types.ts` は以下を基本にする。必要に応じてフィールドを追加してよいが、削除・改名はしない。

```ts
export type Engine = "mysql" | "postgres";

export interface ConnectionRef {
  /** 表示名。MySQL は login-path 名、PostgreSQL は service 名 */
  name: string;
  engine: Engine;
  /** 資格情報ストア上の出自。UI に出す */
  source: "mylogin" | "pg_service" | "env";
}

export interface ResolvedConnection extends ConnectionRef {
  host: string;
  port: number;
  user: string;
  database?: string;
  /** 解決済みパスワード。ログ・画面・エラーに出してはならない */
  password?: string;
}

export interface SchemaRef {
  schema: string;
}

export interface TableRef {
  schema: string;
  table: string;
  type: "table" | "view" | "other";
  /** 概算行数。取得できなければ undefined */
  approxRows?: number;
}

export interface ColumnRef {
  name: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

/** 結果セット。値は Bun.SQL が返した JS 値をそのまま保持する */
export interface ResultSet {
  columns: string[];
  rows: unknown[][];
  /** サーバが返した行数。LIMIT で切られている可能性がある */
  rowCount: number;
  /** さらに次ページがありうるか */
  hasMore: boolean;
  elapsedMs: number;
  /** 実行した SQL。履歴と再実行に使う */
  sql: string;
  offset: number;
}

export interface QueryError {
  message: string;
  /** サーバが返したエラーコード。あれば */
  code?: string;
}

export type Mode = "connections" | "catalog" | "result" | "query" | "help";

export interface HistoryEntry {
  sql: string;
  connection: string;
  executedAt: Date;
  ok: boolean;
}
```

## 資格情報の解決仕様

`core/credentials.ts`。**このモジュールが扱う値は一切、画面・ログ・一時ファイル・エラーメッセージに出してはならない。**

### MySQL（login-path）

- 接続名の一覧は `~/.mylogin.cnf` から取得する。**ファイルは暗号化されているので自前で復号しない。** `my_print_defaults` に委譲する
- `my_print_defaults -s <login-path>` を `util/exec.ts` 経由で実行し、stdout をプロセス内でのみ読む。出力は `--user=...` `--password=...` `--host=...` `--port=...` の行なので、`--key=value` としてパースする
- login-path 名の列挙手段が `my_print_defaults` に無い場合は、設定ファイル（後述）に列挙された名前を候補として扱う
- `my_print_defaults` のパスは、`PATH` → `/opt/homebrew/opt/mysql-client@8.4/bin/my_print_defaults` の順で探す。見つからなければ MySQL の接続は「利用不可」として一覧に理由付きで表示する（アプリは落とさない）
- **環境変数 `MYSQL_TEST_LOGIN_FILE` が設定されていたら、そちらを login path ファイルとして使う。**これは MySQL 標準クライアントと同じ挙動であり、**利用者本人の `~/.mylogin.cnf` を汚さずに検証用の login-path を用意できる**ので、検証時に必須になる

### PostgreSQL

- `~/.pg_service.conf` を INI としてパースし、セクション名を接続名、`host` / `port` / `user` / `dbname` を接続先として読む
- パスワードは `~/.pgpass` から引く。形式は `hostname:port:database:username:password`
  - `*` は任意の値にマッチする
  - `\` は次の 1 文字（`:` と `\`）をエスケープする
  - 上から順に走査し、最初に一致した行を採用する
  - ファイルのパーミッションが 0600 でない場合、libpq と同じく**無視**し、警告を state に積む
- `~/.pg_service.conf` が無い場合は、環境変数（`PGHOST` / `PGPORT` / `PGUSER` / `PGDATABASE`）から 1 件だけ組み立てて `source: "env"` として出す

**`.pgpass` と `.pg_service.conf` のパーサは純粋関数にし、fixture でテストする。**エスケープとワイルドカードの優先順位が唯一の複雑さなので、ここは厚く書く。

## 接続と read-only 強制の仕様

`core/connection.ts`

- `Bun.SQL` に渡す接続 URL を `ResolvedConnection` から組み立てる。`mysql://` / `postgres://` のスキームでアダプタが選ばれる
- **接続直後、最初のクエリを流す前に、必ず以下を実行する。失敗したら接続を破棄し、エラーとして扱う（read-only を確認できない接続は使わせない）**
  - MySQL: `SET SESSION TRANSACTION READ ONLY`
  - PostgreSQL: `SET default_transaction_read_only = on`
- 適用後、実際に効いていることを確認する
  - MySQL: `SELECT @@transaction_read_only` が `1` であること
  - PostgreSQL: `SHOW default_transaction_read_only` が `on` であること
- 確認できたら state に「read-only 確認済み」を持ち、Header に常時表示する

この方式を採る理由は、クライアント側で SQL 文字列を検査する方法には必ず抜け道（コメント、CTE 内の `INSERT ... RETURNING`、複文）が残るからである。**文字列検査で代替してはならない。**

接続は遅延させる。起動時は接続一覧を出すだけで、選択されるまで接続しない。

## 方言の仕様

`core/dialect/`。`Dialect` インタフェースを定義し、MySQL と PostgreSQL で実装する。方言差はすべてここに閉じる。

```ts
export interface Dialect {
  engine: Engine;
  /** 識別子を安全にクォートする */
  quoteIdent(name: string): string;
  listSchemas(): string;
  listTables(schema: string): string;
  listColumns(schema: string, table: string): string;
  /** テーブル閲覧用の SELECT を組み立てる */
  selectAll(
    schema: string,
    table: string,
    limit: number,
    offset: number,
  ): string;
  readOnlyStatements(): string[];
  verifyReadOnly(): string;
}
```

### 識別子のクォート

**ここがこのアプリで唯一の SQL インジェクション面である。**テーブル名・スキーマ名は値ではないのでプレースホルダに置けず、自前でクォートする必要がある。

**`Bun.SQL` に識別子をエスケープする API は無い**（bun-types 1.4.0 の `sql.d.ts` で確認済み。`sql(...)` ヘルパはオブジェクト挿入と `WHERE IN` の値リスト用であり、postgres.js の `sql('ident')` に相当する識別子補間は無い。`sql.unsafe()` は素の文字列連結でエスケープしない）。したがって `quoteIdent` の自前実装は必須であり、代替手段を探さないこと。

- MySQL: バッククォートで囲み、内部のバッククォートは 2 個に増やす
- PostgreSQL: ダブルクォートで囲み、内部のダブルクォートは 2 個に増やす
- どちらも、NUL 文字を含む識別子は拒否する

`quoteIdent` は純粋関数にし、**クォート文字・バックスラッシュ・マルチバイト・空文字を含むケースでテストを書く**。

### カタログ取得

値の受け渡しには必ずプレースホルダを使う。`Bun.SQL` のタグ付きテンプレート（`` sql`... ${value}` ``）が自動でパラメータ化するので、それを使う。**識別子だけが手動クォートの対象である。**

`sql.unsafe(string, values?)` を使ってよいのは次の 2 箇所に限る。それ以外でタグ付きテンプレートを避けないこと。

- ユーザーが Ink 内 editor で書いた SQL の実行（そもそも任意の文字列なので、パラメータ化のしようがない）
- `quoteIdent` を通した識別子を組み込んだカタログ用クエリ。値部分は `sql.unsafe` の第 2 引数でバインドする

- スキーマ一覧
  - MySQL: `information_schema.schemata` から。`information_schema` `performance_schema` `mysql` `sys` は既定で除外し、トグルで表示できるようにする
  - PostgreSQL: `information_schema.schemata` から。`pg_catalog` `information_schema` と `pg_` 前置のものを既定で除外する
- テーブル一覧: 両者とも `information_schema.tables` を使う。概算行数は MySQL が `information_schema.tables.table_rows`、PostgreSQL は `pg_class.reltuples`。取得できなければ `undefined` にする
- カラム一覧: `information_schema.columns` を `ordinal_position` 順で。主キー判定は MySQL が `column_key = 'PRI'`、PostgreSQL は `pg_index` から引く

## クエリ実行仕様

`core/query.ts`

- 実行はすべて `core/connection.ts` の接続経由。タイムアウトは 30 秒
- **結果セット全体をメモリに載せない。**テーブル閲覧の自動生成 SELECT には必ず `LIMIT` / `OFFSET` を付ける（既定 200 行）
- ユーザーが書いた SQL には `LIMIT` を勝手に付けない（`LIMIT` の有無で意味が変わるうえ、構文解析なしに安全に挿入できないため）。代わりに**取得行数の上限を 2000 行とし、超えたら打ち切って「打ち切った」と表示する**
- エラーはサーバのメッセージをそのまま `QueryError` に入れる。**接続 URL やパスワードが混ざらないよう、メッセージに接続文字列が含まれていないか確認してから state に渡す**
- 値は `Bun.SQL` が返した JS 値をそのまま保持する。文字列化は `util/format.ts` の表示層でのみ行う。これにより `NULL` と文字列 `'NULL'` が区別できる

## SQL editor 仕様

`core/query-editor.ts` と `ui/QueryWorkbench.tsx`

- query mode は左に複数行 SQL editor、右に直近の result を同時表示する
- 通常の `Enter` は改行、macOS の `Cmd+Enter` は現在の SQL を実行する
- 文字入力、複数行 paste、backspace / delete、上下左右・行頭・行末の cursor 移動を扱う
- editor / result / history は `Tab` で focus を切り替える
- editor の操作は reducer action として適用し、複数文字が 1 チャンクで届いても入力を失わない
- SQL は `sql-highlight` の segment を Ink の `<Text>` として描画し、cursor 位置だけ inverse にする
- 外部 editor、一時 SQL ファイル、cmux pane は作らない

## ハイライト仕様

`core/highlight.ts`

- `sql-highlight` の `getSegments()` を使う。`{ name, content }` の配列が返り、`name` は `keyword` / `identifier` / `string` / `number` / `comment` / `special` / `function` / `bracket` / `whitespace`
- **既知の欠点を補正する: PostgreSQL のダブルクォート識別子（`"order"` など）が `string` として返る。** engine が postgres のとき、`"` で始まり `"` で終わる `string` セグメントは `identifier` に読み替える
- 補正は純粋関数にし、テストを書く。MySQL のバッククォート識別子、`ILIKE`、`::` キャスト、`left join` のような複合キーワードが正しく分類されることも fixture で固定する
- セグメントを Ink の `<Text color=...>` に 1:1 で対応させる。**ANSI エスケープを含む文字列を `<Text>` に流し込まない**（Ink のレイアウト計算と干渉するため）

## UI 仕様

### 画面モード

**connections**（起動時）

- 利用可能な接続の一覧。列は 接続名、engine、出自（mylogin / pg_service / env）、状態
- 資格情報を解決できなかったものは理由付きでグレー表示し、選択できないようにする

**catalog**

- 左ペインにスキーマ → テーブルのツリー、右ペインに選択中テーブルのカラム一覧
- テーブル上で `Enter` を押すとそのテーブルの先頭ページを取得して result モードへ

**result**

- 上部にクエリの要約（実行時間、行数、打ち切りの有無）、下部に結果グリッド
- **グリッドは端末の高さぶんだけを描画する（自前ウィンドウイング）。** Ink には更新のある行に使える仮想化機構が無く、`<Static>` は追記専用なので使えない
- 列幅は先頭ページのサンプルから決め、はみ出す値は省略記号で切る。`h` / `l` で横スクロールする
- `NULL` は dim の `NULL` で描画し、文字列 `'NULL'`（通常色）と見分けられるようにする

**query**

- 左ペインにハイライト付きの複数行 SQL editor とクエリ履歴、右ペインに直近の result を表示する
- `Cmd+Enter` で実行した後も query mode に留まり、SQL と結果を同時に確認できる

**help**

- キーバインド一覧

### キーバインド

- `j` / `k` または矢印: 上下移動
- `h` / `l`: result では横スクロール、catalog ではペイン移動
- `g` / `G`: 先頭 / 末尾
- `Enter`: schema を展開／折りたたむ。table は選択して次の階層へ
- `Tab`: catalog ⇄ result ⇄ query を巡回
- `Shift+Tab`: query mode の editor / result / history を逆順に巡回
- `e`: query mode の SQL editor に移動する
- `Cmd+Enter`: editor の SQL を実行する
- `r`: 直近のクエリを再実行
- `n` / `p`: 次ページ / 前ページ
- `y`: 選択中のセル値（catalog ではテーブル名）を pbcopy でコピー
- `/`: フィルタ入力。`Esc` で解除
- `?`: help
- `q` / `Esc`: 一つ前のモードへ戻る。connections で押した場合は終了

### StatusBar

- 通常時: 現在モードで使えるキーの一覧
- 実行中: 経過秒数を表示し、`Ctrl-C` で中断できることを示す
- 実行後: 行数と所要時間を 3 秒表示して元に戻す
- エラー時: サーバのエラーメッセージ先頭行を赤で表示する

### Header

- 常時、接続名 / engine / **read-only 確認済みバッジ**を表示する

## 状態管理

`src/state.ts` で `useReducer` 用の reducer を定義する。

```ts
export interface AppState {
  connections: ConnectionRef[];
  current?: ResolvedConnection;
  readOnlyVerified: boolean;
  schemas: SchemaRef[];
  tables: TableRef[];
  columns: ColumnRef[];
  result?: ResultSet;
  error?: QueryError;
  history: HistoryEntry[];
  warnings: string[];
  mode: Mode;
  selectedIndex: number;
  columnOffset: number;
  filter: string;
  filterEditing: boolean;
  message?: string;
  running: boolean;
  lastUpdated?: Date;
}
```

- 状態遷移は「新しい値」ではなく「操作」として dispatch し、現在値への適用は reducer 側で行う。キー入力は複数キーが 1 チャンクで届くことがあり、ハンドラが持つ state は再レンダリング前の古い値になりうるため（launchpeek で踏んだのと同じ問題）
- **`AppState` にパスワードを置かない。**`ResolvedConnection` を state に置く場合は `password` を除いた型にする

## 非機能要件

- アプリはどんな例外でも落ちず、`warnings` か `error` に出す
- 資格情報が画面・ログ・一時ファイルに出ないこと。エラーメッセージも例外ではない
- 起動から接続一覧の表示までは、資格情報ストアの読み取りだけで行う（DB へは接続しない）
- 1 ページ 200 行、横 50 列程度で `j` の長押しが引っかからないこと
- クエリ実行中も UI は操作でき、`Ctrl-C` で中断できる

## 作業手順

以下の順に進め、各ステップの終わりで動作確認とコミットを行う。

1. プロジェクト初期化: `bun init`、依存追加、tsconfig（strict、`jsx: react-jsx`）、`bun run` と `bun test` が通る空の App
2. `core/credentials.ts`: `.pgpass` / `.pg_service.conf` のパーサとテスト（fixture を用意）。`my_print_defaults` 連携もここで
3. `ui/ConnectionList.tsx` と connections モード。接続一覧が出るところまで
4. `core/connection.ts`: `Bun.SQL` 接続と read-only 強制・検証
5. `core/dialect/`: `quoteIdent` とカタログ取得クエリ。`quoteIdent` のテストを厚く書く
6. `ui/CatalogTree.tsx` と catalog モード
7. `core/query.ts` と `ui/ResultGrid.tsx`。自前ウィンドウイング、横スクロール、ページング
8. `core/highlight.ts` と方言補正
9. `core/query-editor.ts` と `ui/QueryWorkbench.tsx`: Ink 内 editor と result の分割表示
10. `core/history.ts`、`core/clipboard.ts`、help、StatusBar の仕上げ
11. `bun build --compile src/index.tsx --outfile sqlclient` でバイナリ化し、README を書く

## 検証方法

- `bun test` が全て通ること

### PostgreSQL の検証環境

この開発機に PostgreSQL は無い（`psql` 未インストール、`~/.pgpass` と `~/.pg_service.conf` も未作成）。移行はこれからなので、**PostgreSQL の検証はローカルの Docker で行う**。

- `docker run --rm -d --name sqlclient-pg -e POSTGRES_PASSWORD=<任意> -p 15432:5432 postgres:17` 相当でコンテナを起動する
- 検証用の `~/.pg_service.conf` と `~/.pgpass` を**このコンテナ向けに作成してよい**（`.pgpass` は `chmod 600` を忘れないこと。パーミッションが緩いと libpq 互換の挙動として無視する仕様なので、その挙動の確認にも使える）
- サンプルテーブルは検証に必要な最小限を自分で作る。**このコンテナ内での DDL / INSERT は検証のためなので構わない**（read-only 強制の対象はアプリが張る接続であって、セットアップではない）

### MySQL の検証環境

- **読み取りの動作確認**は staging と、grant が参照系だけと確認できる production login-path に対して行ってよい。production では grant・read-only状態・schema一覧以外を検証しない
- **read-only 強制の確認**（書き込みが拒否されること）は、`docker run --rm -d --name sqlclient-mysql -e MYSQL_ROOT_PASSWORD=<任意> -p 13306:3306 mysql:8.4` 相当のローカルコンテナに対して行う
- そのコンテナ用の login-path は、**`MYSQL_TEST_LOGIN_FILE` に一時パスを設定したうえで** `mysql_config_editor set` で作る。**利用者本人の `~/.mylogin.cnf` を書き換えてはならない**

検証が終わったらコンテナを落とし、検証用に作った一時ファイルを削除する。

### 手動確認項目

- 以下を手動確認し、README の「動作確認済み」に記録する
  - MySQL（login-path 経由、staging）と PostgreSQL（ローカル Docker）の両方で接続一覧に出て、接続できる
  - Header に read-only バッジが出る
  - **書き込みが実際に拒否されること**を、MySQL と PostgreSQL の**両方で**確認する。ただし**この確認は必ずローカルの Docker に対して行う**（read-only 強制にバグがあった場合、共有環境に書き込みが通ってしまうため。使い捨てのコンテナならバグが出ても無害）
  - カタログを辿ってテーブルのデータが表示され、`n` / `p` でページングできる
  - `e` で Ink 内 editor が開き、`Cmd+Enter` で実行後も SQL と result が同時表示される
  - `NULL` と文字列 `'NULL'` が見分けられる
  - 資格情報が画面のどこにも出ない
- table dataや任意SQLの検証は staging（`ieul_staging` 系 / `taf_staging` 系）またはローカルDockerで行う

## コーディング規約

- TypeScript strict。`any` は使わない。外部入力（設定ファイル、DB の値）は `unknown` から絞り込む
- `core/` は Ink と React に依存しない純粋なモジュールにする
- 非同期処理は必ず try / catch し、失敗は戻り値か `warnings` で伝える
- コメントは「なぜ」を書く。方言差・read-only 強制・資格情報の取り回しには必ず理由を書く
- フォーマットは Prettier 既定に従う
- コミットは作業手順の単位で分ける

## やってはいけないこと

- 書き込み系 SQL を実行しうる経路を作る
- read-only 強制を、クライアント側の SQL 文字列検査で代替する
- `.mylogin.cnf` を自前で復号する
- 資格情報を画面・ログ・一時ファイル・エラーメッセージ・`AppState` に出す
- 識別子を文字列連結でクエリに埋め込む（必ず `quoteIdent` を通す）
- 結果セット全体をメモリに載せる
- Ink の `<Static>` を、更新のある行の描画に使う
- `setRawMode` を直接呼ぶ（Ink の入力管理を使う）
- 指示にない UI ライブラリを追加する

## 既定の判断

迷ったら次のとおりにする。

- 1 ページ 200 行、ユーザー SQL の取得上限 2000 行、クエリタイムアウト 30 秒
- 日時は `YYYY-MM-DD HH:mm:ss` のローカル時刻で表示する
- フィルタは大文字小文字を区別しない
- 色は Ink の標準色名のみ使う
- 端末幅が 80 未満のときは概算行数とデータ型の列を省略する
- 履歴は直近 500 件を `~/.config/sqlclient/history.jsonl` に保存する
- テストが書きにくい箇所は fixture を増やしてでもテストを書く。UI のテストは不要

## 完了の定義

- 作業手順のすべてが完了し、コミットされている
- `bun test` が通る
- 検証方法の手動確認がすべて済み、README に記録されている
- `sqlclient` バイナリが生成され、起動して接続一覧が表示される
