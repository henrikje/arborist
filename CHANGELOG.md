# Changelog

## [0.108.0](https://github.com/henrikje/arborist/compare/v0.107.0...v0.108.0) (2026-03-11)


### Features

* **list:** remove ticket detection column ([d533b0f](https://github.com/henrikje/arborist/commit/d533b0ffca9c8d1847e03256176a00646d564a24))
* **reset:** add --base flag to retarget workspace via reset ([56ab3aa](https://github.com/henrikje/arborist/commit/56ab3aa2d6e751b5c200a5664818ac18362ce7d5))


### Bug Fixes

* **shell:** suggest workspace repos for workspace-scoped commands ([c14f839](https://github.com/henrikje/arborist/commit/c14f83982ca6b4397216454f3d5b966ef048c973))
* **template:** block template add when .arbtemplate counterpart exists ([91562ea](https://github.com/henrikje/arborist/commit/91562eaff86f4a521b66e035332ce7bcaab98fc5))

## [0.107.0](https://github.com/henrikje/arborist/compare/v0.106.0...v0.107.0) (2026-03-11)


### Features

* **delete:** add progress output and parallelize workspace analysis ([534c8c2](https://github.com/henrikje/arborist/commit/534c8c2231e3320e593e9f4bc6d972985334658a))
* **list:** show LAST ACTIVITY column when age filtering is active ([a734941](https://github.com/henrikje/arborist/commit/a734941433fa0f3394fe98b6d511f2ede45a0d02))


### Bug Fixes

* **filter:** fix --older-than/--newer-than activity date accuracy ([4acb400](https://github.com/henrikje/arborist/commit/4acb40043661e7a048b959bfec920e46bc80732e))
* **list:** skip phased table rendering when filters are active ([5975879](https://github.com/henrikje/arborist/commit/59758795c8cb9f33f310d7dce86b1b42875e2e82))

## [0.106.0](https://github.com/henrikje/arborist/compare/v0.105.0...v0.106.0) (2026-03-10)

Improved workspace deletion with safer filtering, interactive selection, and clearer output.

### Features

* **delete:** interactive selection with live plan preview for --where and --all-safe ([550dde6](https://github.com/henrikje/arborist/commit/550dde674a3f9890469174237ee064343356c165))
* **delete:** reduce verbosity of multi-workspace delete output ([b7fe729](https://github.com/henrikje/arborist/commit/b7fe729d45d08640b801b3bf68cd6f7b8cf07791))
* **filter:** add --older-than and --newer-than age-based workspace filtering ([#289](https://github.com/henrikje/arborist/issues/289)) ([7737a8f](https://github.com/henrikje/arborist/commit/7737a8f66581e65444479ea7de116759fa33f43c))
* **template:** distinguish stale templates from user-modified files ([07cdb1f](https://github.com/henrikje/arborist/commit/07cdb1fb75d08c9a9691ec9d3651b87e2b3c9969))


### Bug Fixes

* **render:** strip trailing whitespace from table rows and headers ([f101b9d](https://github.com/henrikje/arborist/commit/f101b9d6dfce53ade5a07b402457aa2cab94a04c))

## [0.105.0](https://github.com/henrikje/arborist/compare/v0.104.1...v0.105.0) (2026-03-09)

Adds new `rename` and `reset` workspace commands, improves pull plan behavior, and harmonizes command options. Introduced JSON-based configuration.

### Features

* **clean:** remove `arb clean` command ([d1a7d18](https://github.com/henrikje/arborist/commit/d1a7d187ce2c2cb064c59baf92939325d2aa417e))
* **config:** replace INI config with JSON validated by Zod schemas ([1b80b7b](https://github.com/henrikje/arborist/commit/1b80b7b9020075f3a7832422b5a82ffe9dc513f2))
* **create:** add interactive base branch selection to guided create ([b5ea052](https://github.com/henrikje/arborist/commit/b5ea0524ed26061e834a044da489b69e6a2c0754))
* **detach:** add --yes/--dry-run to detach and --fetch/--no-fetch to detach, delete, clean ([49bfdd5](https://github.com/henrikje/arborist/commit/49bfdd5fbffa5783f3a200dc252ad795683e9661))
* **pull:** add --force flag to arb pull ([e455424](https://github.com/henrikje/arborist/commit/e4554244fe88d249a83f2f0365af2b7a979f4597))
* **pull:** distinguish forced-reset from safe-reset in pull --force ([ab28696](https://github.com/henrikje/arborist/commit/ab286967bb821e63e8cc520284452c8a1492909e))
* **rename:** add `arb rename` as workspace lifecycle command ([ec6df04](https://github.com/henrikje/arborist/commit/ec6df049f5cc7dd764d75cd96ff6a5639031ace5))
* **reset:** add `arb reset` command to reset repos to base branch ([204815e](https://github.com/henrikje/arborist/commit/204815e707b75b20b4c73ecf42764cc0c3902972))


### Bug Fixes

* **create:** improve base branch selector prompt and filtering ([725e53c](https://github.com/henrikje/arborist/commit/725e53c72c455dc30aaa5927003d57a5d53eb0e4))
* **delete:** fetch each repo once across all candidate workspaces ([1348ee2](https://github.com/henrikje/arborist/commit/1348ee2e32f26eb99854d2e7bb601b97672ac630))
* **install:** always add install dir to path ([100f18d](https://github.com/henrikje/arborist/commit/100f18df0b82c43cd31e145fda20b9ce56040173))
* **pull:** show "no remote branch" instead of "not pushed yet" in pull skip message ([3e04a14](https://github.com/henrikje/arborist/commit/3e04a14935a6a5cd9d47d142bfbf1b003552a1f6))

## [0.104.1](https://github.com/henrikje/arborist/compare/v0.104.0...v0.104.1) (2026-03-08)


### Bug Fixes

* clarify "merged with new work" messaging in push output ([2b7ea1a](https://github.com/henrikje/arborist/commit/2b7ea1a4c50a2ece78ba3f8eb73fc99147749ec6))

## [0.104.0](https://github.com/henrikje/arborist/compare/v0.103.0...v0.104.0) (2026-03-08)

Improves workspace creation and everyday Git workflows with a more guided arb create, smarter push behavior, and clearer status reporting with conflict predictions. This release also significantly strengthens resilience by automatically detecting and repairing moved projects, renamed workspaces, and corrupted worktree references.

### Features

* add --include-merged for merged branch pushes ([987b6c9](https://github.com/henrikje/arborist/commit/987b6c9e43b5922acd0bf49305051804c1b2a877))
* add --yes flag to create command to skip interactive prompts ([20c827a](https://github.com/henrikje/arborist/commit/20c827a8e7545933d725538f40a1f62b6f69c096))
* add arb dump command for capturing workspace state ([9a12988](https://github.com/henrikje/arborist/commit/9a12988423f3729629e77fd7e2e8f66302b5f8ab))
* add default repos for workspace creation ([46e6e0d](https://github.com/henrikje/arborist/commit/46e6e0df63c51b92fe4bc7ea017626bbbecaf1b3))
* add timeout protection for all git network operations ([027f761](https://github.com/henrikje/arborist/commit/027f761dea22e4b0bd8acd1cf01f722ee2bbdd97))
* always print resolved values in arb create ([#233](https://github.com/henrikje/arborist/issues/233)) ([0f1b446](https://github.com/henrikje/arborist/commit/0f1b446d6b405d51646951771112283034fdc572))
* auto-navigate to project root after deleting current workspace ([c59617a](https://github.com/henrikje/arborist/commit/c59617a0eca34c2b47f60c19e9c2cc46074651e6))
* auto-repair worktree refs after workspace directory rename ([a01568e](https://github.com/henrikje/arborist/commit/a01568e8780ec3ad5a4578acd4a94d9ab82cafc1))
* avoid unnecessary rebase replay for squash-equivalent commits ([#223](https://github.com/henrikje/arborist/issues/223)) ([8b2511d](https://github.com/henrikje/arborist/commit/8b2511da97e303bfe9dc374d1e3a0ee37d233ddc))
* default confirmation prompts to yes ([6f7c727](https://github.com/henrikje/arborist/commit/6f7c727c2475f99a01ba5e7d34340ce6710cdb08))
* detect and repair project directory moves ([f52f5ee](https://github.com/henrikje/arborist/commit/f52f5ee54d66850f5f0e0ea24c821e702f033862))
* detect replaced commits via reflog for accurate share status ([#239](https://github.com/henrikje/arborist/issues/239)) ([b450086](https://github.com/henrikje/arborist/commit/b4500862346d7327b5eba0ddef007e6d5595f424))
* enforce minimum Git 2.17 version requirement ([b4f75ee](https://github.com/henrikje/arborist/commit/b4f75ee01ac722222b414767070b0c7701ce5f12))
* improve arb create UX with interactive branch selector ([618e3d0](https://github.com/henrikje/arborist/commit/618e3d03a4bdbbf5f080e0d5cc5e375d3a18babc))
* improve network error handling for offline and degraded connectivity ([6f1ec5d](https://github.com/henrikje/arborist/commit/6f1ec5d0e58c61a77c8ec4bf4ce610e698226e40))
* include conflict predictions in status --json output ([e43b1de](https://github.com/henrikje/arborist/commit/e43b1deab25b38ce0e65504c8cc3a5399c1737bc))
* introduce "project" as primary user-facing term ([0bc8954](https://github.com/henrikje/arborist/commit/0bc89542f1ae92697bb4fea0f1757e4a1fd0b1cd))
* **log:** add --verbose flag to show commit bodies and changed files ([#251](https://github.com/henrikje/arborist/issues/251)) ([e063ac4](https://github.com/henrikje/arborist/commit/e063ac474cd39bf3e97085888aaac57fea3b3f5e))
* make workspace rename opt-in via --rename-workspace [name] ([1fd4fb6](https://github.com/henrikje/arborist/commit/1fd4fb6cd6f36aec191f62673ed3566aefcfeb91))
* move rebranch into branch group as rename subcommand ([3a22498](https://github.com/henrikje/arborist/commit/3a22498b26200c0a08d6fdad36fbafc4f04a2d82))
* predict pull conflicts for status share-side highlighting ([97991d6](https://github.com/henrikje/arborist/commit/97991d6718e1d02d726da46d5bb733456600f03b))
* **push:** auto-push when all remote commits are outdated ([042e131](https://github.com/henrikje/arborist/commit/042e1314470e8846e18eb3fc677a8ddb367d9753))
* refresh arb create adaptive interaction flow ([ddaefb5](https://github.com/henrikje/arborist/commit/ddaefb5cf83fd38d7366892bf6970d2440bf72d6))
* safely reset pull on rebased remote without local work ([#222](https://github.com/henrikje/arborist/issues/222)) ([89189ca](https://github.com/henrikje/arborist/commit/89189ca608b729c68d2d5dcb0e3431211ee91bab))
* show "to pull" commits in verbose status with arrow separator in SHARE cell ([24754c7](https://github.com/henrikje/arborist/commit/24754c7d2613f4bc5a181c58de71565eee6b9598))
* show remote branch name in push plan for new/recreated branches ([f568196](https://github.com/henrikje/arborist/commit/f56819603c8434266242e8cf177b614ef20a9737))
* three-way rebase status split (fromBase / rebased / new) ([1a992a6](https://github.com/henrikje/arborist/commit/1a992a6eafd98a9a778df4767e2a2bf82ab4b239))


### Bug Fixes

* abort and roll back workspace on failed worktree attach during create ([bce8a9e](https://github.com/henrikje/arborist/commit/bce8a9e2627fb5b0c35e30280648aaeb371a500f))
* add word boundaries to ticket detection regex ([8c28a8c](https://github.com/henrikje/arborist/commit/8c28a8c607aa285b7bb85c4a049558f955bf38ed))
* allow retarget when some repos lack the target branch ([b743b55](https://github.com/henrikje/arborist/commit/b743b556b14d35c814cd4f33a151cae5d1e42667))
* auto-repair shared worktree entry corruption ([be9a122](https://github.com/henrikje/arborist/commit/be9a12206a350190956648820208a2aab4de7ee7))
* auto-repair shared worktree entry corruption ([#228](https://github.com/henrikje/arborist/issues/228)) ([781862a](https://github.com/henrikje/arborist/commit/781862afe6a4417d8f287d77ce010dd8b57effb5))
* **ci:** exclude root-level .md files from code change detection ([a84a6b6](https://github.com/henrikje/arborist/commit/a84a6b618f71f0b3b09a9e5a3268916ecf17456f))
* derive workspace name from --branch in non-tty create ([de6ff28](https://github.com/henrikje/arborist/commit/de6ff28045f00c5d51d279bff02345cd570ac526))
* disable looping in interactive selectors ([653cb38](https://github.com/henrikje/arborist/commit/653cb387a0ab1348ef474e7d2f28178c1a809506))
* docs, completions, fetch flags, and stale references ([eff30ff](https://github.com/henrikje/arborist/commit/eff30ffa3a60e3c22ceba2ef472e86fb5544e8d1))
* ensure base is changed on retarget when all repos are up to date ([bc6f7ab](https://github.com/henrikje/arborist/commit/bc6f7ab61dec2e114001532e132423ae4edfde3b))
* guard isTTY against Bun epoll_ctl EEXIST on Linux ([28b1ec6](https://github.com/henrikje/arborist/commit/28b1ec64134961ae59a678fbbd9a0d7b7ad72ceb))
* join merge and three-way wording in pull output ([1d70aeb](https://github.com/henrikje/arborist/commit/1d70aeb07450200495261ba19b5ddcd6d777be10))
* prevent phased render from leaving stale output on screen ([#240](https://github.com/henrikje/arborist/issues/240)) ([3919057](https://github.com/henrikje/arborist/commit/3919057e44d57b7d5196d316aa1cafde1194dc7a))
* prevent worktree entry corruption from cross-workspace prune ([9dad27b](https://github.com/henrikje/arborist/commit/9dad27b6fc49873c6a0bff67b4b4ed36438e5f28))
* re-link worktree in place when directory has files with stale reference ([570bda1](https://github.com/henrikje/arborist/commit/570bda109f374ba78a381be26f1fb3084e7465a1))
* require confirmation before deleting empty workspaces ([#238](https://github.com/henrikje/arborist/issues/238)) ([06c532a](https://github.com/henrikje/arborist/commit/06c532af6bf14317e71f336a1ab6c5bd2df9cf1d))

## [0.103.0](https://github.com/henrikje/arborist/compare/v0.102.0...v0.103.0) (2026-03-02)

This release improves status and push protection for merged branches with new commits, adds local PR and ticket detection, and introduces an `arb branch` command with verbose per-repo tracking details.

### Features

* add --where status filter to push, pull, rebase, and merge ([23479f5](https://github.com/henrikje/arborist/commit/23479f5680820c61764933d790658f6124502609))
* add `arb branch` command and remove branch header from status ([8bce263](https://github.com/henrikje/arborist/commit/8bce2633a54ba26abf488192c36ffcf75f0a1571))
* add escape-to-cancel for background fetch in dashboard commands ([369bbe9](https://github.com/henrikje/arborist/commit/369bbe9b6b48294a13189cc32a4477a67c2782f9))
* add help topics for remotes, stacked, templates, and scripting ([1f361ea](https://github.com/henrikje/arborist/commit/1f361ea78499b1b59c96b41c0837cc7271d1cc05))
* add verbose mode to arb branch with per-repo tracking detail ([659374a](https://github.com/henrikje/arborist/commit/659374a23ec09a19cf8c896bc738e70e22051f97))
* add zod schemas and --schema flag for JSON output contracts ([bb20147](https://github.com/henrikje/arborist/commit/bb201472577b37917faf537885835bd4df99f082))
* align plan output columns for push, pull, rebase, and merge ([36bad54](https://github.com/henrikje/arborist/commit/36bad5424bf20b7d11c713e45872880ba452de41))
* detect merge commits by parentage when subject lacks branch name ([b201b3d](https://github.com/henrikje/arborist/commit/b201b3def26126b419937122a815e29af17dc804))
* detect PRs and tickets from local git data ([6782e63](https://github.com/henrikje/arborist/commit/6782e63cc7d9b8bef3627bbb9975957f41efed0e))
* extract --where help into dedicated `arb help where` topic ([1cd0842](https://github.com/henrikje/arborist/commit/1cd08422db438049391d3982a154e1fcd8219cd7))
* improve status and push protection for merged branches with new commits ([3d473cc](https://github.com/henrikje/arborist/commit/3d473cc7c8b702991f1f2634b265868c8e1337a7))
* replace -F/--fetch short option with -N/--no-fetch ([ee3f845](https://github.com/henrikje/arborist/commit/ee3f8458b832ffaffbc67a545468e10b57396bbf))


### Bug Fixes

* add leading blank line before table in delete and clean commands ([7cb756c](https://github.com/henrikje/arborist/commit/7cb756c8887c124b0766045f5a4ef75cc940f558))
* improve PR detection coverage and squash path parity ([08bf6df](https://github.com/henrikje/arborist/commit/08bf6df489b0c749c1df23a12d73a6b3ab38cb57))
* reject unknown repos in detach command ([7bb90d8](https://github.com/henrikje/arborist/commit/7bb90d86d70a064225271e8b5bcf221be100e1b6))


### Performance Improvements

* deduplicate git subprocess spawns with request-scoped GitCache ([6e35784](https://github.com/henrikje/arborist/commit/6e35784f15ff8855cb7c51b8a4d9d756acf202d7))
* only fetch workspace repos in arb list ([bb91a80](https://github.com/henrikje/arborist/commit/bb91a80ce873100deff86400b27b6345e03ffd44))

## [0.102.0](https://github.com/henrikje/arborist/compare/v0.101.0...v0.102.0) (2026-02-27)

Rebase and merge plans are now even smarter, with improved conflict prediction, branch visualization, and automatic detection of already-merged branches. It also brings auto-fetch to status/list and a curl-pipe-bash installer.

### Features

* add --dry-run to repo remove ([02b61f7](https://github.com/henrikje/arborist/commit/02b61f7f8a73bc0a82b775051752c6753539cb17))
* add --graph flag to rebase and merge for branch divergence visualization ([ff072c9](https://github.com/henrikje/arborist/commit/ff072c9a3f5857b91de46042c36f1484245c56b0))
* annotate behind-base commits with rebase/squash match info ([85e4725](https://github.com/henrikje/arborist/commit/85e4725f4e15e912b7d5d0af6ccdf8973ed54c56))
* auto-fetch by default for status and list commands ([24f1445](https://github.com/henrikje/arborist/commit/24f144563244fa1829a03341f0c23b971979a3ed))
* detect merged branches and skip them during rebase/merge ([6829fd1](https://github.com/henrikje/arborist/commit/6829fd1b504744343d0d0be160df3f50098cdc67))
* dim benign skip reasons in sync plans ([e74f105](https://github.com/henrikje/arborist/commit/e74f105862b59b3ba310bb8bd8366081749d8a27))
* identify conflicting commits in rebase plans ([de60753](https://github.com/henrikje/arborist/commit/de60753104504f99bf89af2bde5588da2b0a1667))
* show merge status for orphaned branches in arb clean ([0d368f2](https://github.com/henrikje/arborist/commit/0d368f287ad8887de563e9a069c1add48c56709f))
* show merge type in pull plans and diff stats in verbose mode ([22d0ef8](https://github.com/henrikje/arborist/commit/22d0ef899dd2ce3b01fc19742b7a6a47f3f68733))
* show retarget replay prediction in rebase plans ([4abb14a](https://github.com/henrikje/arborist/commit/4abb14a87cc237770837a1865053141e817e55f8))
* support curl-pipe-bash installation via GitHub Releases ([fc808f2](https://github.com/henrikje/arborist/commit/fc808f2315cef5f3651be7e324d14ad8c603da2f))


### Bug Fixes

* eliminate blank screen gap in phased rendering ([0fafbff](https://github.com/henrikje/arborist/commit/0fafbff56097baee3d3a54a1cfd9065ac941a562))
* remove local scope from tmp_dir in install script ([a08501c](https://github.com/henrikje/arborist/commit/a08501c8cd38e458cf1b2325158eca3342639232))
* stop --force from implying --yes in arb delete ([e1c5ab2](https://github.com/henrikje/arborist/commit/e1c5ab28989338aa6831a48f8e0043858ef2f4d4))
* validate repo names in create command before git operations ([d34f49a](https://github.com/henrikje/arborist/commit/d34f49ac7a885d38b036e34f7328f32a980c6444))

## [0.101.0](https://github.com/henrikje/arborist/compare/v0.100.0...v0.101.0) (2026-02-26)

Initial binary release.

### Features

* add --all-ok flag to remove command for batch cleanup ([353f6d0](https://github.com/henrikje/arborist/commit/353f6d07da29954552bdb744e6698875753be3ba))
* add --all-repos to add/drop, multi-workspace remove, rewrite README ([a300db1](https://github.com/henrikje/arborist/commit/a300db1d9b9fa17793aaac331cd33bfa5b720805))
* add --autostash flag to rebase, merge, and pull ([9e2cf64](https://github.com/henrikje/arborist/commit/9e2cf643dfc276db8275bba42e6500fb44ec1b22))
* add --base option to arb create for stacked PRs ([94f381e](https://github.com/henrikje/arborist/commit/94f381e86091d7267c7c20409ecbd14cd57bac58))
* add --dirty flag to list and delete commands ([76f79d0](https://github.com/henrikje/arborist/commit/76f79d03557b267741a8aaedc8af90cda68df9b9))
* add --dry-run flag to state-changing commands ([#17](https://github.com/henrikje/arborist/issues/17)) ([fc4f63b](https://github.com/henrikje/arborist/commit/fc4f63bfd156f7ecce8806728de3508674d04747))
* add --json output to list command ([#15](https://github.com/henrikje/arborist/issues/15)) ([376a86e](https://github.com/henrikje/arborist/commit/376a86ec501f602f313da43cbf5539560742b387))
* add --quiet flag and stdin piping for composable shell scripting ([1242aa3](https://github.com/henrikje/arborist/commit/1242aa3348476a5263567e28eb717545e9d989c7))
* add --repo flag to exec and open commands ([#33](https://github.com/henrikje/arborist/issues/33)) ([1b9f07e](https://github.com/henrikje/arborist/commit/1b9f07e0872757893fa81943d85f8a5fdd471885))
* add --verbose flag to rebase, merge, push, and pull ([ebc021f](https://github.com/henrikje/arborist/commit/ebc021fa1c0a52a1c2c44bbe7bd4a8bbff0260a4))
* add --where filter completion to zsh shell script ([#36](https://github.com/henrikje/arborist/issues/36)) ([4a5c24b](https://github.com/henrikje/arborist/commit/4a5c24bd699dd6f4ce4f5f571b781480d7409208))
* add --where flag for status filtering across commands ([#27](https://github.com/henrikje/arborist/issues/27)) ([c090ef0](https://github.com/henrikje/arborist/commit/c090ef004e4281460986f99ceaa5e6ee1b69c0e2))
* add --yes flag to remove and unify confirmation prompts ([#18](https://github.com/henrikje/arborist/issues/18)) ([02b34a9](https://github.com/henrikje/arborist/commit/02b34a98fb8a74e6f20669f9270544392523e411))
* add -v short option for status --verbose ([#47](https://github.com/henrikje/arborist/issues/47)) ([e707703](https://github.com/henrikje/arborist/commit/e707703698338cf0495f8d349e5136ba33d8d83e))
* add .arbtemplate placeholder substitution and duplicate conflict detection ([#52](https://github.com/henrikje/arborist/issues/52)) ([dbf46aa](https://github.com/henrikje/arborist/commit/dbf46aa4a5733dcca11da1107c73b91bb3b1c430))
* add `arb cd` command to navigate to workspace directories ([#8](https://github.com/henrikje/arborist/issues/8)) ([4737de0](https://github.com/henrikje/arborist/commit/4737de063ae7cd3fe37aad030a4c7884c6158611))
* add `diff` command and refine command boundaries ([9e0f6ac](https://github.com/henrikje/arborist/commit/9e0f6acf2ec464ee57944be670196b6d69572e05))
* add `log` command ([197b276](https://github.com/henrikje/arborist/commit/197b276820f04835897c8a2aee53e75a76c321f3))
* add `rebranch` command to rename workspace branch across all repos ([91b1704](https://github.com/henrikje/arborist/commit/91b17042149b202390b634887e761dac6906630a))
* add `repo remove` command ([413713d](https://github.com/henrikje/arborist/commit/413713d3cc97b6728657de2e9c43edcbd2cfcc21))
* add AND semantics to --where filtering with + operator ([12f49a7](https://github.com/henrikje/arborist/commit/12f49a7a4c25b7b6034c3b61837482ce32585662))
* add arb clean command for housekeeping non-workspace directories ([751af70](https://github.com/henrikje/arborist/commit/751af70dca20dd80f873ef2e6c9ace2064354016))
* add arb workspace manager ([7ec05ea](https://github.com/henrikje/arborist/commit/7ec05ea0b3798ebe307237e004b9509031848094))
* add automated release pipeline with GitHub Releases and Homebrew tap ([b92c969](https://github.com/henrikje/arborist/commit/b92c9697f21100ab82394a72b77d8aae58b8ec4b))
* add bash shell integration with wrapper function and tab completion ([#57](https://github.com/henrikje/arborist/issues/57)) ([e00a5b5](https://github.com/henrikje/arborist/commit/e00a5b515cfa6f36ffbe0060b9cc8368fa682c11))
* add Claude Code skill with auto-install  ([#16](https://github.com/henrikje/arborist/issues/16)) ([57bf4aa](https://github.com/henrikje/arborist/commit/57bf4aae7b51f612e07a6c1fc7eaa8bf3e3f87e1))
* add column headers to status/list, redesign list, add --at-risk ([ffa101c](https://github.com/henrikje/arborist/commit/ffa101cf0d2ea5c478302a8ad9c4bc53130d2ac8))
* add consistent notices for --dry-run and --yes across all commands ([#60](https://github.com/henrikje/arborist/issues/60)) ([df17d18](https://github.com/henrikje/arborist/commit/df17d18ae80f131496cdba94582677b1ebde13bb))
* add decision records for significant design choices ([db3f84f](https://github.com/henrikje/arborist/commit/db3f84f7dfc25574357809684296584bff84b67f))
* add fork workflow support with publish/upstream remote roles ([715ed28](https://github.com/henrikje/arborist/commit/715ed2898b309799c0d475cb3d6e24a3948d8552))
* add getting-started guidance to init and list ([e927e9c](https://github.com/henrikje/arborist/commit/e927e9c1133bad561e863aae2a9df062b77309d6))
* add global -C flag to override working directory ([#21](https://github.com/henrikje/arborist/issues/21)) ([68381e8](https://github.com/henrikje/arborist/commit/68381e8ba5520e6b9b297d02e7f40c580cef8480))
* add HEAD SHA to status JSON and operation plan displays ([#13](https://github.com/henrikje/arborist/issues/13)) ([f76cc6d](https://github.com/henrikje/arborist/commit/f76cc6d95d340388adcb5c6d44225e73e63bc8c2))
* add isDiverged flag and conflict prediction for integration commands ([#38](https://github.com/henrikje/arborist/issues/38)) ([06d2dd1](https://github.com/henrikje/arborist/commit/06d2dd14e442f666dd6aef145e813fc82fe11488))
* add LAST COMMIT column to status and list commands ([#23](https://github.com/henrikje/arborist/issues/23)) ([3d178cf](https://github.com/henrikje/arborist/commit/3d178cf819b648a4f4c7e8bb9984ca80af26b06f))
* add MIT license ([c106e07](https://github.com/henrikje/arborist/commit/c106e07cdb497b741cd4312b973af2e9ed9b114d))
* add phased rendering for `arb list` ([e8dacf9](https://github.com/henrikje/arborist/commit/e8dacf990d4007f7e905d9444d34ea82e32fdda4))
* add playground setup scripts and reorganize test directory ([40c248c](https://github.com/henrikje/arborist/commit/40c248ca3e2fb16a5a2dbb34420bbcd3c6232531))
* add positive filter terms and ^ negation to --where ([a41d698](https://github.com/henrikje/arborist/commit/a41d6982c0c3992a60b0c289a193a24eee7342c9))
* add rebase/merge commands, rewrite push/pull, normalize output ([df4d2bf](https://github.com/henrikje/arborist/commit/df4d2bf66ac3d3cedc3671c987f3b594431f7a95))
* add repo filtering to status and untracked hints to diff ([57f5eb1](https://github.com/henrikje/arborist/commit/57f5eb13439b933e26d2aa6888fb73a58d953679))
* add summary and description to all CLI commands ([1bb954f](https://github.com/henrikje/arborist/commit/1bb954f22c4b3bf86a45febdf65570aa1f69be08))
* add summary line to arb status ([ecd6085](https://github.com/henrikje/arborist/commit/ecd6085cea6afaefef1425a3b08a31255e2d841e))
* add template management commands (add, remove, list, diff, apply) ([#29](https://github.com/henrikje/arborist/issues/29)) ([a46c5c0](https://github.com/henrikje/arborist/commit/a46c5c02457150028fc70c3a8a1612536adb59e8))
* add two-phase rendering for `arb status -F` ([250cb0d](https://github.com/henrikje/arborist/commit/250cb0de9d24fbe06d49569947648baa655258a5))
* add universal -F/--fetch and --no-fetch flags to all relevant commands ([25ffe8c](https://github.com/henrikje/arborist/commit/25ffe8c7dcd08c99263bd152634ea2e888d4d136))
* add workspace template system for seeding files into new workspaces ([b56c091](https://github.com/henrikje/arborist/commit/b56c091d088e5cc2dcce34deefa77f95eedaebc0))
* align at-risk, yellow coloring, and remove safety around named flag sets ([#64](https://github.com/henrikje/arborist/issues/64)) ([63b98b9](https://github.com/henrikje/arborist/commit/63b98b927a3ab42d67283b872f1869ff23c2d1ca))
* allow `rebase --retarget` to accept an optional target branch ([cefb596](https://github.com/henrikje/arborist/commit/cefb5968ecb1e2b25deb3d3f8a4fcedf96a725a7))
* auto-cd into workspace after arb create ([#30](https://github.com/henrikje/arborist/issues/30)) ([7e88fd0](https://github.com/henrikje/arborist/commit/7e88fd021655ec3f0dea1e163b024cc1f78cc93e))
* check out existing remote branch on workspace create ([8c40762](https://github.com/henrikje/arborist/commit/8c40762ea4b259a4f05b952688d1876e75102abd))
* **cli:** update help command groups ([a13b3d4](https://github.com/henrikje/arborist/commit/a13b3d4f00af45364fd68101de47a328519c1731))
* compact status display for long branch names ([eaf8311](https://github.com/henrikje/arborist/commit/eaf83116684cdc14f5460aab9001d98ddadccf82))
* compute semantic version from conventional commits ([8fa78f9](https://github.com/henrikje/arborist/commit/8fa78f9673eab7a8f8f2b5e2dc05321726d2d0ee))
* consolidate fetch progress into single self-updating line ([#35](https://github.com/henrikje/arborist/issues/35)) ([28e0608](https://github.com/henrikje/arborist/commit/28e06087b95900bd96d07bee4bfc289cde243427))
* continue past conflicts in rebase, merge, and pull ([#4](https://github.com/henrikje/arborist/issues/4)) ([db7d590](https://github.com/henrikje/arborist/commit/db7d590822602f849f178cd673b317a5f129e250))
* **delete:** make --where select workspaces without positional args ([0094d69](https://github.com/henrikje/arborist/commit/0094d6994e936615f2926b36e1ee2aa4fcdb8d00))
* detect gone remote branches after merge and auto-delete ([207e02d](https://github.com/henrikje/arborist/commit/207e02dafc8c24886354fdb96b2efe61431409ba))
* detect merged branches via ancestor check and cumulative patch-id ([8ae2260](https://github.com/henrikje/arborist/commit/8ae226046a7f2a64cba5a10af36e9e3a1c0d8dbe))
* detect rebased commits using git patch-id ([522662c](https://github.com/henrikje/arborist/commit/522662c7f6c806ab255269679e218567673653bb))
* detect stacked base branch merged into default and add --retarget ([9613825](https://github.com/henrikje/arborist/commit/96138254e73502e65397d824b6c89e521a6dacf8))
* detect template drift in arb remove ([#2](https://github.com/henrikje/arborist/issues/2)) ([ad1ca01](https://github.com/henrikje/arborist/commit/ad1ca01068d9732903405445a336d60e8f59b3c1))
* expose remote URLs in template context ([43e0fd6](https://github.com/henrikje/arborist/commit/43e0fd6f8a6a32556c2432a90a0c23f4cd559978))
* fetch by default for mutation commands ([#14](https://github.com/henrikje/arborist/issues/14)) ([7834505](https://github.com/henrikje/arborist/commit/7834505591f5e1f3f322edfd3ccb5ef371bca648))
* improve create output and add plural() helper ([#1](https://github.com/henrikje/arborist/issues/1)) ([ef4efa6](https://github.com/henrikje/arborist/commit/ef4efa63b58b017c208b8512a155ad20e17df99c))
* include working tree changes in arb diff ([ddd8e48](https://github.com/henrikje/arborist/commit/ddd8e48ba5e3bdd9a54205e2dc81482be2caab79))
* infer template add scope from source path instead of CWD ([c4e9520](https://github.com/henrikje/arborist/commit/c4e9520a48c6d92c9db3fa82397d475c713ae7e1))
* introduce canonical status model as single source of truth ([#20](https://github.com/henrikje/arborist/issues/20)) ([125e8b5](https://github.com/henrikje/arborist/commit/125e8b55702a2cd5f2f2bb3fa056ab3b9caf7344))
* make push --force imply --yes, matching remove behavior ([#34](https://github.com/henrikje/arborist/issues/34)) ([a20fec5](https://github.com/henrikje/arborist/commit/a20fec53764d6e5e345b1e2bd095a6b8985067ee))
* move LAST COMMIT column to between REPOS and STATUS in list output ([#24](https://github.com/henrikje/arborist/issues/24)) ([ff8b509](https://github.com/henrikje/arborist/commit/ff8b509ad14013a7a58d2884a307971623281c72))
* overhaul help text and streamline README ([081df43](https://github.com/henrikje/arborist/commit/081df43095c790203f75a4acfbaf40da97fd4b39))
* pass-through options for exec and open commands ([6c28838](https://github.com/henrikje/arborist/commit/6c28838551bcd23f7be4c59e322ad5e3c994f8e8))
* per-flag status coloring in list and clean up status output ([#22](https://github.com/henrikje/arborist/issues/22)) ([3d855a3](https://github.com/henrikje/arborist/commit/3d855a35e15388aaffe12bcd754088bd57400fc0))
* recreate gone remote branches on `arb push` ([#11](https://github.com/henrikje/arborist/issues/11)) ([93ef606](https://github.com/henrikje/arborist/commit/93ef60683e1bac05d6ca76a4258537055d901728))
* remove global --workspace option, reassign -w to --where ([#32](https://github.com/henrikje/arborist/issues/32)) ([8e3925d](https://github.com/henrikje/arborist/commit/8e3925d2db54eba7e7e844cdc4d931ceebcbb30f))
* rename remove/add/drop to delete/attach/detach ([0368fb2](https://github.com/henrikje/arborist/commit/0368fb22687f8c37baa1f944b04f58730c14a956))
* render template list as columnar table with deleted detection ([a623ea8](https://github.com/henrikje/arborist/commit/a623ea801918e85b49b7af55e4312ad8c15224d6))
* replace remove output with concise columnar table ([#25](https://github.com/henrikje/arborist/issues/25)) ([aa0ed81](https://github.com/henrikje/arborist/commit/aa0ed81714db7ee856807aa46d8dcbb0b2b27089))
* replace template placeholders with LiquidJS rendering engine ([2390340](https://github.com/henrikje/arborist/commit/23903401e8585691a6f118742ae07c1d398daf42))
* restore template add command for onboarding UX ([f599d88](https://github.com/henrikje/arborist/commit/f599d88561db3a19b58c992e1bd289b8a836b5c0))
* run bun install on post-checkout via lefthook ([8dfc837](https://github.com/henrikje/arborist/commit/8dfc8377acb570506bf4ff15cc812a3fd24ba347))
* scope fetch to selected repos in push, rebase, merge, status, diff, log ([e51532a](https://github.com/henrikje/arborist/commit/e51532a475d3c0b6c91b6fdfafce87bc753386fb))
* scope-aware resolution for `arb cd` and `arb path` ([49153db](https://github.com/henrikje/arborist/commit/49153dbba6f8ffb9f485b380cb8284803f1277f8))
* show "no conflict" instead of "conflict unlikely" for fast-forward repos ([adfb5dc](https://github.com/henrikje/arborist/commit/adfb5dca512e378f6eec929691a82409b830b65a))
* show behind-base annotations in push plan ([#63](https://github.com/henrikje/arborist/issues/63)) ([46bcc81](https://github.com/henrikje/arborist/commit/46bcc81d34bef45eb3043b5f7471bdf8dc351e79))
* show branch header line in arb status ([5d230c3](https://github.com/henrikje/arborist/commit/5d230c35998b2a53021ca8a9f97f4e59b6abd4d5))
* show remote roles in repo list ([89c9710](https://github.com/henrikje/arborist/commit/89c9710dd0ae6b214f2dd7bc7c3add5e0995f963))
* show remote URL in `arb repos` output ([#49](https://github.com/henrikje/arborist/issues/49)) ([c93c90b](https://github.com/henrikje/arborist/commit/c93c90b18b8d7307dea9bc0d580af5f9fdeb58b1))
* show workspace path in arb create success message ([4f4c678](https://github.com/henrikje/arborist/commit/4f4c678ab9239c23cd4341206a0245a1de3c6d98))
* support --json --verbose for detailed machine-readable status output ([#59](https://github.com/henrikje/arborist/issues/59)) ([1ee967e](https://github.com/henrikje/arborist/commit/1ee967ebeb3d3c28384382cfee061abab3d7df5d))
* support directories in `arb template add` ([cce3ab6](https://github.com/henrikje/arborist/commit/cce3ab68176a2ca68beede1e1c42579f24217f2d))
* suppress implied statuses when branch is merged ([f7cc325](https://github.com/henrikje/arborist/commit/f7cc325aac067d8b715aa23aaac33a95458a9421))
* two-phase plan render for instant feedback during fetch ([#42](https://github.com/henrikje/arborist/issues/42)) ([10d5819](https://github.com/henrikje/arborist/commit/10d58198561e3821d021d454d69fc7ea166a96ea))
* update zsh completions for all commands and options ([#45](https://github.com/henrikje/arborist/issues/45)) ([99ba4cb](https://github.com/henrikje/arborist/commit/99ba4cbf8926c16668f32bb7549bc61c5e2636b9))
* use merge-tree conflict prediction for status coloring ([#43](https://github.com/henrikje/arborist/issues/43)) ([b487f60](https://github.com/henrikje/arborist/commit/b487f6049c68305d7d3130ee96cb3f8fc107b3ac))
* warn on unknown template variables in .arbtemplate files ([f37068a](https://github.com/henrikje/arborist/commit/f37068aeef37d7360d7ef09a0c3d0004c6c40d71))


### Bug Fixes

* add -F/--fetch flag to rebranch for fetch flag convention ([2b02053](https://github.com/henrikje/arborist/commit/2b020535603447b568be2e36a61247694a6512dc))
* always show remote/ref in status base column ([#41](https://github.com/henrikje/arborist/issues/41)) ([42e523b](https://github.com/henrikje/arborist/commit/42e523bbd3e86a01b0c4e44a2a1fec05c266326c))
* check workspace directory exists before interactive prompts ([#31](https://github.com/henrikje/arborist/issues/31)) ([4c2742f](https://github.com/henrikje/arborist/commit/4c2742fd825fa81dffae7da39a41a0bf6d3b3a38))
* correct documentation inaccuracies across docs ([cb6efc5](https://github.com/henrikje/arborist/commit/cb6efc5867a6eb08d6341f3c53eed3aac73a8076))
* correct help text inaccuracies across commands ([585fa4f](https://github.com/henrikje/arborist/commit/585fa4f30f9a477cc16caed1242f20a9f9418c44))
* correct phase comment numbering in pull command ([de105bd](https://github.com/henrikje/arborist/commit/de105bdf32750fd64a89bfc14884aebc5a6cc7e1))
* correct tab completion for both bash and zsh shells ([5ac3640](https://github.com/henrikje/arborist/commit/5ac3640736d13ce98207815446a358475c95b28a))
* correct terminology and wording across codebase ([e4c58d6](https://github.com/henrikje/arborist/commit/e4c58d6c761a29c7feb3f81434dd959cfac1afd1))
* correct TTY guards for interactive prompts ([7ea9185](https://github.com/henrikje/arborist/commit/7ea9185352ae80c6f79fdaa00e768cffa23c7a6e))
* decouple --force from --yes in push command ([1c5a104](https://github.com/henrikje/arborist/commit/1c5a104d845a7f88cbef90eb7686ee755b517377))
* detach HEAD in canonical repos after clone ([e4fdf4e](https://github.com/henrikje/arborist/commit/e4fdf4e28fc782a11654507faf01ae474a9d1d0f))
* detect stacked base branch merged when remote branch is deleted ([488eff4](https://github.com/henrikje/arborist/commit/488eff411529b925edc6e128b4f8604305864809))
* don't double-count repos in status summary ([3e4a93d](https://github.com/henrikje/arborist/commit/3e4a93d77afa6d3d693117d604e0f1f3c5a50d6d))
* enable rename detection in arb diff ([62a73d9](https://github.com/henrikje/arborist/commit/62a73d979bae3637434aba2ba706765cfc747c4a))
* ensure fresh build on install ([2c75870](https://github.com/henrikje/arborist/commit/2c758703e4937197079232c0f69e5493454325ae))
* exclude component name from release-please tags ([97e127b](https://github.com/henrikje/arborist/commit/97e127b717c79f12f5468f1004c410011e32cece))
* fail gracefully when exec command is not found in PATH ([#48](https://github.com/henrikje/arborist/issues/48)) ([a0e854b](https://github.com/henrikje/arborist/commit/a0e854babd2ff563c49fce3e9ba255a0fcff030a))
* fetch both remotes in status, show merge type in plan ([#40](https://github.com/henrikje/arborist/issues/40)) ([7d9683e](https://github.com/henrikje/arborist/commit/7d9683e6497778b6d4b0326864c59f89b1e73be8))
* handle empty interactive selection, allow empty workspaces ([2e0b9f8](https://github.com/henrikje/arborist/commit/2e0b9f8dcf9c878daf2b1e8ba40ec5e592977c8e))
* improve command consistency across the CLI ([eae6ab8](https://github.com/henrikje/arborist/commit/eae6ab878973fef9d790dd2cbb4bd6e2956e8e00))
* include behind-base workspaces in remove --all-ok ([122fd67](https://github.com/henrikje/arborist/commit/122fd6770928a5016341825398514e2e781698a0))
* include config-missing and empty workspaces in quiet list output ([9711c49](https://github.com/henrikje/arborist/commit/9711c4942d66f4655545e7c995b1933c37254ab6))
* only flag unpushed when there are commits at risk ([94dfe30](https://github.com/henrikje/arborist/commit/94dfe300950f0616a4b8fb2a3132489c52243342))
* place -w flag before subcommand in merge-conflict test ([5720ef4](https://github.com/henrikje/arborist/commit/5720ef424cb14e03801fe1bc2b0a2ab18e18c2a7))
* prevent false merged status for never-pushed branches ([91e3fe9](https://github.com/henrikje/arborist/commit/91e3fe9f192f4f73b6ed1f697c56fbd0629b0895))
* prioritize attention-worthy status labels and stabilize tests ([410903b](https://github.com/henrikje/arborist/commit/410903b5d7af6ac8b74cd861bb3dc8d10d66cc5d))
* propagate command renames from decision 0024 ([78d645b](https://github.com/henrikje/arborist/commit/78d645b404b19b7b9f2ace246d7db2430729bbba))
* **pull:** allow pull when merged into base but share has commits to pull ([4636c70](https://github.com/henrikje/arborist/commit/4636c70310b0811a5485bd3899d2bb370b2dcda6))
* redirect all [@inquirer](https://github.com/inquirer) prompts to stderr to prevent arb cd hanging ([#12](https://github.com/henrikje/arborist/issues/12)) ([159ae65](https://github.com/henrikje/arborist/commit/159ae65a3945b3b2b0b2566fde6959ae1a471398))
* **remotes:** propagate ambiguous remote resolution errors ([03e5931](https://github.com/henrikje/arborist/commit/03e59311dc07452dc269f750c2440221a7594172))
* remove hardcoded default branch name in integration tests ([#9](https://github.com/henrikje/arborist/issues/9)) ([3f4f0da](https://github.com/henrikje/arborist/commit/3f4f0da9486b8a80cb75d093ef9c351d2ee5db2e))
* remove hints, drop cd command, polish CLI output ([d9a0223](https://github.com/henrikje/arborist/commit/d9a0223c2a5666fdf3b72fc2a23d1c25ff7ef847))
* renumber duplicate decision record 0026 ([0ddbfa4](https://github.com/henrikje/arborist/commit/0ddbfa490c7987e2fc69c7ff676644147ea8d3c0))
* repair shell completions for template and repo subcommands ([#56](https://github.com/henrikje/arborist/issues/56)) ([ff7b20f](https://github.com/henrikje/arborist/commit/ff7b20f8bf90d2dab52f11befa2e0ad2e78e35ea))
* require --yes for confirmation when stdin is piped ([2213ce7](https://github.com/henrikje/arborist/commit/2213ce76bd49a58cdd8d000e941b9c7c6d53fe69))
* restore template add in shell completions after rebase ([f394f6a](https://github.com/henrikje/arborist/commit/f394f6a8a8dfb98c0425a3419d25e49ae4a893ef))
* route errors through output module and fix color semantics ([0b2ebda](https://github.com/henrikje/arborist/commit/0b2ebda8c583f4feec1407f51291023a17af3e46))
* set explicit cwd on all spawn calls to prevent posix_spawn ENOENT ([#7](https://github.com/henrikje/arborist/issues/7)) ([daf134a](https://github.com/henrikje/arborist/commit/daf134aa323437ea7de78826990124264f4e565b))
* show all subcommands in command group help output ([f8941b9](https://github.com/henrikje/arborist/commit/f8941b97a67e36faebf83fa0afcd6055cfb9bbe2))
* show configured base branch with "not found" when fallback occurs in status ([192fb3f](https://github.com/henrikje/arborist/commit/192fb3f349993af510107954de041c549b567ee7))
* show correct commit count on first push ([#3](https://github.com/henrikje/arborist/issues/3)) ([57b22bf](https://github.com/henrikje/arborist/commit/57b22bf22ac1d6b1a4bfe16744117af23cab2fdf))
* show manual shell setup instructions when zsh is not detected ([1fddf63](https://github.com/henrikje/arborist/commit/1fddf6393abcc7b3f1f04b6714547b1ab1a20413))
* skip push for new branches with no commits ([#51](https://github.com/henrikje/arborist/issues/51)) ([019526c](https://github.com/henrikje/arborist/commit/019526c3cc1c4786afab4a73d61e1eb625e7bc25))
* **status:** remove at-risk exit code from status command ([38ee59f](https://github.com/henrikje/arborist/commit/38ee59f0c0d6a43de8a0f6c412927921b333ef82))
* **status:** skip merge detection when on the default branch ([ccbd93b](https://github.com/henrikje/arborist/commit/ccbd93bbb7db7c6785d13a8b6227bc529792e83a))
* swap repo list column order to REPO → BASE → SHARE and always show base remote name ([81a56b3](https://github.com/henrikje/arborist/commit/81a56b3b502bdf3b486a05993f5c1de18059331b))
* update green color guideline to match behavior ([4c5bd3c](https://github.com/henrikje/arborist/commit/4c5bd3cb52da8e429c988b25e1bdfd4f6dfe90da))
* update shell completions for current command set ([b547a05](https://github.com/henrikje/arborist/commit/b547a051648165827baa2ff8a96f15ffc572d7b1))
* use "repos" instead of "worktrees" in attach/detach help text ([3e8a62d](https://github.com/henrikje/arborist/commit/3e8a62d4be9765d206fe95e77f744eb147935e23))
* use bold instead of green for active workspace marker ([8f49ba9](https://github.com/henrikje/arborist/commit/8f49ba9ca089b3257141640a67a41ab43070f3be))
* use compact output for batch workspace removal ([183c115](https://github.com/henrikje/arborist/commit/183c1157d40978f64911603a7a4849b6ead8b5d9))
* use PAT for release-please to trigger CI on release PRs ([554332c](https://github.com/henrikje/arborist/commit/554332ca298c572f6ddfb4029c06f902a3762a19))


### Performance Improvements

* parallelize arb list and arb status ([#5](https://github.com/henrikje/arborist/issues/5)) ([10516b9](https://github.com/henrikje/arborist/commit/10516b999727bef39da435ca26e03d9e285670fb))
* **sync:** parallelize assess phase across repos ([62f2def](https://github.com/henrikje/arborist/commit/62f2deff418aaa7f3ba646b62d9b4b615fa83dc8))
