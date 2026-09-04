# Design decisions

## 資格情報は選択時に解決する

接続一覧に必要なのは名前と出自だけなので、起動時にはpasswordを解決しない。選択時に標準ツール／ファイルから読み、DB sessionを作った直後に参照を捨てることで、React stateや描画エラーが秘密値を巻き込む範囲を狭めた。

MySQL名の列挙には、passwordを常にマスクする `mysql_config_editor print --all` を使う。暗号化ファイルの形式へ依存せず、MySQL公式ツールを信頼境界にできるためである。

## 書き込み防止はDB権限に委ねる

SQL文字列の許可リストやsessionの既定値は、任意SQLから回避できるため安全境界として扱わない。アプリは入力されたSQLを変更せず、書き込み防止は専用のread-only DBアカウントに委ねる。これにより、アプリが保証できない状態をread-only確認済みとして表示しない。

staging / productionのような接続名は認可情報として扱わない。接続先の選択肢を名前で制限しない代わりに、利用者がcredential storeへ書き込み権限のないアカウントだけを登録することを前提とする。

## 物理connectionをreserveする

schema選択、クエリ実行、cancel対象のbackend IDを同じserver sessionへ結び付けるため、選択中はpoolからreserveした1本だけを使う。接続確認前の失敗や切断後はそのsessionを再利用しない。

## cancelは別connectionからserverへ送る

Bun 1.4.0では実行中でも `Query.active` がfalseのままになり、`Query.cancel()` もPostgreSQL/MySQLの実測でクエリを止めなかった。接続時にbackend IDを取得し、短命なcontrol connectionからPostgreSQLは `pg_cancel_backend`、MySQLは `KILL QUERY` を送る。さらにserver sessionにも30秒timeoutを設定し、UI timerだけに安全性を依存させない。

MySQLの `KILL QUERY` はprepared parameterを受け付けないため、ここだけはcatalog／任意SQL以外の `unsafe` 利用になる。埋め込む値をサーバから取得後に正のsafe integerへ絞り、利用者入力を到達させないことで、この例外をSQL injection面にしない。

## 任意SQLを改変しない

Bun.SQL 1.4には行streamingやmaxRows APIがないため、「SQLを変えない」「2000行で受信を止める」「全結果を一時保持しない」を同時には満たせない。SQLの意味と対応構文を保つことを優先し、Bunから返却された直後に2000行へ切り詰める。stateとInk描画は有界になるが、一時的なdriverメモリは有界にならないことを既知の制約として公開する。

## reducerには操作を渡す

端末入力は複数キーが1チャンクで届くことがあり、イベントhandlerが捕捉したindexをdispatchすると同一render中の更新が失われる。移動量とitem数をactionにして、最新stateへのclampをreducer側で行う。

## catalogのschemaを接続の既定値にする

login-pathはdatabaseを保持できないため、MySQL接続直後の既定databaseは利用者がcatalogで見ているschemaと一致しない。schemaを開く操作でMySQLは `USE`、PostgreSQLは `search_path` を同じreserved sessionへ設定し、手書きSQLの非修飾table名が画面上の文脈と一致するようにした。

## editorとresultをInk内で並べる

SQLを直接書く利用を主導線として、catalogでschemaを選択した後はtable一覧を取得せずquery modeへ移動する。table閲覧は削除せず、catalogで `l` / 右矢印を押したときだけ一覧を取得する補助導線として残す。

query modeはSQLを書きながら直前の結果を参照できるよう、左editor・右resultのworkbenchにした。通常のEnterは改行に使い、実行はmacOSでterminalへ伝達できる `Cmd+Enter` に分離する。文字入力・paste・cursor移動は操作actionとしてreducerへ渡すため、複数文字が1チャンクで届いても欠落しない。historyも左下へ残し、Tabでfocusを切り替える。

## 表示量を端末サイズで制限する

Inkの `Static` は追記専用で選択行の更新に向かない。catalog、history、resultはいずれも選択位置の周辺だけをrenderし、resultのcolumnも端末幅へ収まる分だけ作る。DB取得上限だけではReact要素数を抑えられないため、取得・保持・描画を別々に制限している。

resultの幅計算には文字数ではなく `Bun.stringWidth` を使う。日本語や絵文字を含む値でも罫線を揃え、数値列は右寄せ、文字列は左寄せにして比較しやすくする。

## 検証用credential storeを分離する

PostgreSQLはlibpq標準の `PGSERVICEFILE` / `PGPASSFILE`、MySQLは `MYSQL_TEST_LOGIN_FILE` を尊重する。Docker検証で利用者本人のstoreを書き換えず、同じparser／resolver経路を通せるためである。

## loopbackだけMySQL公開鍵取得を許可する

TLSなしのRSA公開鍵取得は中間者にpasswordを奪われる可能性がある。Bunのopt-inはlocalhost、127.0.0.1、`::1` に限定し、共有環境では有効にしない。ローカルDocker以外はTLSまたはサーバ側の認証設定を前提とする。
