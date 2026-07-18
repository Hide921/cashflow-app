# Supabaseセキュリティ移行

アプリは移行前のスキーマを自動検出し、その間は既存データを使うレガシーモードで動作します。

## 適用手順

1. Supabase Dashboard の Authentication > Providers で Email を有効にする。
2. SQL Editor で `migrations/20260719090000_secure_user_data.sql` を実行する。
3. 直後にアプリを開き、所有者のメールアドレスで最初のユーザー登録・ログインを行う。
4. 最初にログインしたユーザーへ、既存の `accounts` と `transactions` が自動的に引き継がれたことを確認する。
5. GitHubリポジトリの Actions secret に `SUPABASE_SERVICE_ROLE_KEY` を登録する。日次バックアップはRLS適用後、このキーを使用する。

## 注意

既存データを引き継げるのは最初にログインしたユーザーだけです。個人用アプリでは、SQL適用から初回ログインまでの間を空けないでください。移行後は匿名アクセスが無効になり、各ユーザーは自分の行だけを読み書きできます。
