# Team chat — console setup (Development)

Chat works as soon as step 1 is done (it polls). Steps 2–3 add attachments and live updates.

## 1. Data Store table `TeamMessages` (required)

Console → Cloud Scale → Data Store → New Table. All columns are **Var Char** unless noted.

| Column         | Type                | Notes                                   |
|----------------|---------------------|-----------------------------------------|
| `team_id`      | Var Char (50)       |                                         |
| `sender_id`    | Var Char (50)       |                                         |
| `sender_name`  | Var Char (200)      |                                         |
| `message`      | **Text**            | up to 4000 chars                        |
| `message_type` | Var Char (20)       | text / image / video / audio / pdf / file |
| `file_id`      | Var Char (50)       | empty for text                          |
| `file_name`    | Var Char (255)      |                                         |
| `file_size`    | Var Char (20)       |                                         |
| `read_by`      | **Text**            | comma-separated user ids (grows with team size) |
| `created_time` | Var Char (30)       | `YYYY-MM-DD HH:mm:ss` UTC               |

Table scope: **Organization** (same as the other tables). No extra permissions needed;
the function accesses it server-side.

## 2. File Store folder for attachments (needed for file uploads)

Console → Cloud Scale → File Store → New Folder (e.g. `team-chat`). Copy its ID into
`functions/cred_360_function/chat-config.js` → `CHAT_FOLDER_ID`.

Uploads allowed: png/jpg/gif/webp, mp4/webm/mov, mp3/wav/ogg/m4a, pdf, doc/docx, xls/xlsx, txt, csv, zip (10 MB max).

## 3. Data Streams channel (optional — live updates)

1. Console → Cloud Scale → Data Streams → create a channel (e.g. `team_chat_pings`).
2. Set the channel's access control so **app users** can subscribe.
3. Put its ID/name into `chat-config.js` → `CHAT_CHANNEL`.
4. `@zcatalyst/datastreams` requires **Node >= 22**; this function is `node18` in
   `catalyst-config.json`. Switch the function's stack to a Node 22 runtime if Catalyst offers
   it for your plan, then redeploy. Until then the server side stays disabled and chat polls.

The channel only carries `{"t":"msg","team_id":"…","id":"…"}` pings — never message text.
Clients re-fetch through the authenticated API, which enforces team membership.

## 4. Deploy

```
catalyst deploy --only functions
catalyst deploy --only client
```
