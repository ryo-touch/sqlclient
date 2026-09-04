# Design decisions

## 資格情報は選択時に解決する

接続一覧に必要なのは名前と出自だけなので、起動時にはpasswordを解決しない。選択時に標準ツール／ファイルから読み、DB sessionを作った直後に参照を捨てることで、React stateや描画エラーが秘密値を巻き込む範囲を狭めた。

MySQL名の列挙には、passwordを常にマスクする `mysql_config_editor print --all` を使う。暗号化ファイルの形式へ依存せず、MySQL公式ツールを信頼境界にできるためである。

## 物理connectionをreserveする

read-onlyはconnection pool全体ではなくserver sessionの属性である。設定したconnectionと実クエリのconnectionがずれることを防ぐため、選択中はpoolからreserveした1本だけを使う。確認前の失敗や切断後はそのsessionを再利用しない。

staging / productionのような接続名は認可情報として扱わない。Auroraを含む接続先が返すread-only状態を正本とし、確認できたsessionだけを利用する。これによりproduction用login-pathも、DB側の権限とread-only設定を保ったまま使用できる。

Aurora MySQLでは、参照専用アカウントでもsessionの `transaction_read_only` が `0` から変わらない構成がある。この場合だけ `SHOW GRANTS FOR CURRENT_USER()` を確認し、`SELECT` を必須とした既知の参照系権限だけで構成されていれば、アカウント権限によるserver-side強制として受け入れる。grant文字列を理解できない場合や書き込みにつながる権限があればfail closedにする。

## cancelは別connectionからserverへ送る

Bun 1.4.0では実行中でも `Query.active` がfalseのままになり、`Query.cancel()` もPostgreSQL/MySQLの実測でクエリを止めなかった。接続時にbackend IDを取得し、短命なcontrol connectionからPostgreSQLは `pg_cancel_backend`、MySQLは `KILL QUERY` を送る。さらにserver sessionにも30秒timeoutを設定し、UI timerだけに安全性を依存させない。

MySQLの `KILL QUERY` はprepared parameterを受け付けないため、ここだけはcatalog／任意SQL以外の `unsafe` 利用になる。埋め込む値をサーバから取得後に正のsafe integerへ絞り、利用者入力を到達させないことで、この例外をSQL injection面にしない。

## 任意SQLを改変しない

Bun.SQL 1.4には行streamingやmaxRows APIがないため、「SQLを変えない」「2000行で受信を止める」「全結果を一時保持しない」を同時には満たせない。SQLの意味と対応構文を保つことを優先し、Bunから返却された直後に2000行へ切り詰める。stateとInk描画は有界になるが、一時的なdriverメモリは有界にならないことを既知の制約として公開する。

## reducerには操作を渡す

端末入力は複数キーが1チャンクで届くことがあり、イベントhandlerが捕捉したindexをdispatchすると同一render中の更新が失われる。移動量とitem数をactionにして、最新stateへのclampをreducer側で行う。

## catalogのschemaを接続の既定値にする

login-pathはdatabaseを保持できないため、MySQL接続直後の既定databaseは利用者がcatalogで見ているschemaと一致しない。schemaを開く操作でMySQLは `USE`、PostgreSQLは `search_path` を同じreserved sessionへ設定し、手書きSQLの非修飾table名が画面上の文脈と一致するようにした。

## 表示量を端末サイズで制限する

Inkの `Static` は追記専用で選択行の更新に向かない。catalog、history、resultはいずれも選択位置の周辺だけをrenderし、resultのcolumnも端末幅へ収まる分だけ作る。DB取得上限だけではReact要素数を抑えられないため、取得・保持・描画を別々に制限している。

## 検証用credential storeを分離する

PostgreSQLはlibpq標準の `PGSERVICEFILE` / `PGPASSFILE`、MySQLは `MYSQL_TEST_LOGIN_FILE` を尊重する。Docker検証で利用者本人のstoreを書き換えず、同じparser／resolver経路を通せるためである。

## loopbackだけMySQL公開鍵取得を許可する

TLSなしのRSA公開鍵取得は中間者にpasswordを奪われる可能性がある。Bunのopt-inはlocalhost、127.0.0.1、`::1` に限定し、共有環境では有効にしない。ローカルDocker以外はTLSまたはサーバ側の認証設定を前提とする。
