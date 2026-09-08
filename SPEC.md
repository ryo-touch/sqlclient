# sqlclient 仕様書

このファイルは `sqlclient` の現行仕様を記録する。利用手順は `README.md`、設計理由は `docs/design.md` を正本とする。

## 概要

MySQL / PostgreSQL のread-onlyアカウントへ接続し、スキーマとテーブルを辿りながら、任意の SQL を書いて結果を確認できるターミナルアプリ。

- ローカル端末で利用する
- Bun + TypeScript + Ink で実装する
- SQLは解析・制限せず、そのままDBへ送る。書き込み防止はDBアカウントの権限に委ねる
- 資格情報はアプリで管理しない。MySQL は `.mylogin.cnf` の login-path、PostgreSQL は `.pg_service.conf` と `.pgpass` という各 DB の標準ストアをそのまま読む

## 成果物

- `bun run src/index.tsx` で起動するアプリ
- `bun build --compile` で生成できる単一バイナリ `sqlclient`
- README（起動方法、接続の用意、キーバインド、既知の制約）
- `core/` のユニットテスト

## 環境前提

- macOS 26 以降
- Bun 1.3.14 以降
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
- カタログ閲覧: スキーマ → テーブル
- テーブルのデータ閲覧（自動生成の SELECT、ページング）
- 任意 SQL の実行（Ink 内の SQL editor と result を左右に同時表示する）
- 結果グリッドの表示、横スクロール、セル値のコピー、TSV への書き出し
- SQL draft の外部editorでの編集
- 選択schemaのtable名・column名による識別子の補完
- session を維持したままの接続切り替えと再接続
- クエリ履歴

対象外

- アプリ側でのSQL許可リスト、書き込み防止、DB権限の検証
- 接続情報の新規登録・編集（既存の標準ストアを読むだけ）
- SQLite、その他の RDBMS
- SSH トンネル
- 診断・formatting、および文脈を解釈する IDE 相当の補完
- 結果の CSV / JSON エクスポート（書き出しは TSV のみ）

## ディレクトリ構成

```
sqlclient/
  src/
    index.tsx            エントリポイント。render(<App />)
    app.tsx              画面の組み立てと副作用の配線
    state.ts             reducer と Action 型
    types.ts             型定義
    hooks/
      use-app-actions.ts 接続・カタログ・クエリ・書き出しの操作
      use-app-input.ts   モードごとのキーバインド
    core/
      credentials.ts     login-path / .pgpass / .pg_service.conf の解決
      connection.ts      Bun.SQL のラップ。接続、timeout、cancelを扱う
      catalog.ts         スキーマ・テーブル・カラムの取得
      query.ts           クエリ実行、ページング、結果の正規化
      query-editor.ts    複数行編集と cursor 操作の純粋関数
      external-editor.ts $VISUAL / $EDITOR の解決と一時 .sql ファイルの受け渡し
      export.ts          resultのTSV書き出し
      status-hints.ts    モードごとのキー一覧と端末幅への収め方
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
    catalog.test.ts
    clipboard.test.ts
    connection.test.ts
    credentials.test.ts
    dialect.test.ts
    export.test.ts
    external-editor.test.ts
    format.test.ts
    highlight.test.ts
    history.test.ts
    query-editor.test.ts
    query.test.ts
    state.test.ts
    status-hints.test.ts
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

## 接続と安全境界の仕様

`core/connection.ts`

- `ResolvedConnection` はURL文字列へ変換せず、`adapter` / `hostname` / `port` / `username` / `password` / `database` の構造化optionとして `Bun.SQL` へ渡す
- IPv6 literalは角括弧を除いたhostとして渡す
- 選択中はpoolから1本をreserveし、schema選択、クエリ、backend IDを同じsessionへ結び付ける
- MySQLは `max_execution_time`、PostgreSQLは `statement_timeout` を30秒へ設定する
- アプリはSQL文字列やgrantを検査せず、read-only確認済みという状態や表示を持たない
- 書き込み防止には、対象schema/tableへの参照権限だけを持つ専用DBアカウントを使う

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
  /** テーブル閲覧用の SELECT を組み立てる */
  selectAll(
    schema: string,
    table: string,
    limit: number,
    offset: number,
  ): string;
  tableParameters(schema: string): readonly unknown[];
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

カタログ取得は `Ctrl-C` の中断要求を、ユーザーSQLと同じく**ちょうど一度だけ**消費する。中断されたカタログ取得は結果を捨てて「Query cancelled」として報告する。ただしschema選択のようにサーバのsession状態を動かす文は例外で、サーバ側で完了した場合は中断要求を消費したうえで成功として扱う（選択済みschemaとHeaderの表示が食い違わないようにするため）。

- スキーマ一覧
  - MySQL: `information_schema.schemata` から。`information_schema` `performance_schema` `mysql` `sys` は既定で除外し、トグルで表示できるようにする
  - PostgreSQL: `information_schema.schemata` から。`pg_catalog` `information_schema` と `pg_` 前置のものを既定で除外する
- テーブル一覧: 両者とも `information_schema.tables` を使う。概算行数は MySQL が `information_schema.tables.table_rows`、PostgreSQL は `pg_class.reltuples`。取得できなければ `undefined` にする

## クエリ実行仕様

`core/query.ts`

- 実行はすべて `core/connection.ts` の接続経由。タイムアウトは 30 秒
- テーブル閲覧の自動生成 SELECT には必ず `LIMIT` / `OFFSET` を付ける（既定 200 行）
- ユーザーが書いた SQL には `LIMIT` を勝手に付けない。Bun.SQLから結果を受信した直後に、stateと画面へ保持する行を2000行へ切り詰める。driverが一時的に全結果を保持する可能性は既知の制約とする
- エラーはサーバのメッセージをそのまま `QueryError` に入れる。**接続 URL やパスワードが混ざらないよう、メッセージに接続文字列が含まれていないか確認してから state に渡す**
- 値は `Bun.SQL` が返した JS 値をそのまま保持する。文字列化は `util/format.ts` の表示層でのみ行う。これにより `NULL` と文字列 `'NULL'` が区別できる

## SQL editor 仕様

`core/query-editor.ts` と `ui/QueryWorkbench.tsx`

- query mode は左に複数行 SQL editor、右に直近の result を同時表示する
- 通常の `Enter` は改行、macOS の `Cmd+Enter` は現在の SQL を実行する
- editorにfocus中の `Ctrl-G` は現在のSQLを一時 `.sql` ファイルへ書き出し、外部editorで編集する
- editorにfocus中の `Ctrl-Space` は選択schemaのtable名・column名からcursor直前の識別子を補完する。metadataの初回取得は実行中のクエリとして扱い、その間は他の実行キーを受け付けず `Ctrl-C` で中断できる
- 外部editorは `VISUAL`、次に `EDITOR` を参照し、引用符を含む引数付きcommandを保持する
- 外部editorの実行中はInkの入力とrenderの両方を止めて端末を渡し、終了後に画面を再描画して編集結果をdraftへ反映し、一時ファイルを削除する
- 文字入力、複数行 paste、backspace / delete、上下左右・行頭・行末の cursor 移動を扱う
- editor / result / history は `Tab` で focus を切り替える
- editor の操作は reducer action として適用し、複数文字が 1 チャンクで届いても入力を失わない
- SQL は `sql-highlight` の segment を Ink の `<Text>` として描画し、cursor 位置だけ inverse にする

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
- 接続先で `Enter` を押すと接続し、catalog modeへ移動する

**catalog**

- 全幅でスキーマ → テーブルのツリーを表示する
- schemaで `Enter` を押すと接続の既定schemaへ設定し、table一覧を読み込まずにquery modeへ移動する
- schemaで `l` / 右矢印を押した場合だけtable一覧を読み込み、`h` / 左矢印で折りたたむ
- テーブル上で `Enter` を押すとそのテーブルの先頭ページを取得して result モードへ

**result**

- 上部にクエリの要約（実行時間、行数、打ち切りの有無）、下部に結果グリッド
- **グリッドは端末の高さぶんだけを描画する（自前ウィンドウイング）。** Ink には更新のある行に使える仮想化機構が無く、`<Static>` は追記専用なので使えない
- 列幅は先頭ページのサンプルから決め、はみ出す値は省略記号で切る。`h` / `l` で横スクロールする
- `NULL` は dim の `NULL` で描画し、文字列 `'NULL'`（通常色）と見分けられるようにする

**query**

- 左ペインにハイライト付きの複数行 SQL editor とクエリ履歴、右ペインに直近の result を表示する
- `Cmd+Enter` で実行した後も query mode に留まり、SQL と結果を同時に確認できる
- catalogでschemaを選択した後の主画面とし、`Esc` でcatalogへ戻れる
- 端末高が28行未満、または履歴が空ならHistory paneを非表示にし、SQL editorへ高さを割り当てる
- History非表示時はfocus巡回からhistoryを除外する。表示時も履歴は最大5件とし、残りの高さをSQL editorへ割り当てる

**help**

- キーバインド一覧

### キーバインド

- `j` / `k` または矢印: 上下移動
- `h` / `l`: catalogの折りたたみ／展開、resultの横スクロール
- `g` / `G`: 先頭 / 末尾
- `Enter`: connectionsでは接続してcatalogへ移動する。catalogではschemaを選択してqueryへ移動し、tableではresultを開く
- `Tab`: catalog ⇄ result ⇄ query を巡回
- `Shift+Tab`: query mode の editor / result / history を逆順に巡回
- `e`: query mode の SQL editor に移動する
- `Cmd+Enter`: editor の SQL を実行する
- `Ctrl-G`: query editor の SQL を外部editorで編集する
- `Ctrl-Space`: query editor のtable名・column名を補完する
- `Ctrl-X`: 現在のsessionを維持したまま接続一覧を開く。新しい接続の成功後に旧sessionを閉じる
- `Ctrl-R`: 現在の接続設定を再解決して再接続する
- `s`: catalogでsystem schemaの表示を切り替える
- `r`: 直近のクエリを再実行
- `n` / `p`: 次ページ / 前ページ
- `y`: 選択中のセル値（catalog ではテーブル名）を pbcopy でコピー
- `w`: resultの保持中データをカレントディレクトリへTSVで書き出す。`Date` はISO 8601、`Uint8Array` は16進数、objectはJSON、`NULL` は空欄とする
- `/`: フィルタ入力。`Esc` で解除
- `?`: help
- `q` / `Esc`: 一つ前のモードへ戻る。connections で押した場合は終了

### StatusBar

- 通常時: 現在モードで使えるキーの一覧。モードごとに重要な順の一覧を 1 本だけ持ち、端末幅に応じて 表記の短縮 → 末尾の省略 の順で収める。**狭い端末で出るキーは、広い端末で出るキーの接頭辞でなければならない**。現在のモードから抜けるキーは 80 桁で必ず残す
- 実行中: 経過秒数を表示し、`Ctrl-C` で中断できることを示す
- 実行後: 行数と所要時間を 3 秒表示して元に戻す
- エラー時: サーバのエラーメッセージ先頭行を赤で表示する

### Header

- 常時、接続名 / engine / 選択中のschemaとtableを表示する

## 状態管理

`src/state.ts` で `useReducer` 用の reducer を定義する。

```ts
export interface AppState {
  connections: ConnectionRef[];
  current?: ResolvedConnection;
  schemas: SchemaRef[];
  tables: TableRef[];
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

## 検証方法

- `bun test` が全て通ること

### PostgreSQL の検証環境

PostgreSQLの接続検証はローカルのDockerで行う。

- `docker run --rm -d --name sqlclient-pg -e POSTGRES_PASSWORD=<任意> -p 15432:5432 postgres:17` 相当でコンテナを起動する
- `PGSERVICEFILE` / `PGPASSFILE` には一時ファイルを指定し、利用者のcredential storeを変更しない
- セットアップ用管理者と、アプリ接続用のread-onlyユーザーを分ける

### MySQL の検証環境

- 接続検証は `docker run --rm -d --name sqlclient-mysql -e MYSQL_ROOT_PASSWORD=<任意> -p 13306:3306 mysql:8.4` 相当のローカルコンテナに対して行う
- そのコンテナ用の login-path は、**`MYSQL_TEST_LOGIN_FILE` に一時パスを設定したうえで** `mysql_config_editor set` で作る。**利用者本人の `~/.mylogin.cnf` を書き換えてはならない**
- セットアップ用管理者と、アプリ接続用のread-onlyユーザーを分ける

検証が終わったらコンテナを落とし、検証用に作った一時ファイルを削除する。

### 手動確認項目

- 以下を手動確認し、README の「動作確認」に記録する
  - MySQL（login-path経由）とPostgreSQL（service経由）の両方で接続一覧に出て、接続できる
  - Header に接続名 / engine / schema / tableが出る
  - read-onlyユーザーでは書き込みがDB権限エラーになる。この確認はローカルDockerだけで行う
  - カタログを辿ってテーブルのデータが表示され、`n` / `p` でページングできる
  - `e` で Ink 内 editor が開き、`Cmd+Enter` で実行後も SQL と result が同時表示される
  - `NULL` と文字列 `'NULL'` が見分けられる
  - 資格情報が画面のどこにも出ない
- table dataや任意SQLの検証はローカルDockerまたは安全性を確認済みのstagingで行う

## コーディング規約

- TypeScript strict。`any` は使わない。外部入力（設定ファイル、DB の値）は `unknown` から絞り込む
- `core/` は Ink と React に依存しない純粋なモジュールにする
- 非同期処理は必ず try / catch し、失敗は戻り値か `warnings` で伝える
- コメントは「なぜ」を書く。方言差・資格情報の取り回しには必ず理由を書く
- フォーマットは Prettier 既定に従う
- コミットは論理的な変更単位で分ける

## やってはいけないこと

- アプリのsession設定や表示を、書き込み防止の保証として扱う
- ユーザーSQLを許可リスト判定または自動書き換えする
- `.mylogin.cnf` を自前で復号する
- 資格情報を画面・ログ・一時ファイル・エラーメッセージ・`AppState` に出す
- 識別子を文字列連結でクエリに埋め込む（必ず `quoteIdent` を通す）
- 受信後の任意SQL結果を2000行を超えてstateへ保持する
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
- テストが書きにくい箇所は純粋関数へ切り出し、fixtureを増やしてテストする

## 完了の定義

- `bun test` が通る
- typecheck、Prettier check、単一バイナリbuildが通る
- README、仕様書、実装の安全性に関する表現が一致している
- `sqlclient` バイナリが生成され、起動して接続一覧が表示される
