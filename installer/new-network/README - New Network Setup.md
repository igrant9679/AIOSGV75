# Agentic Operations Control: New Network Installer

Use this folder to set up **Agentic Operations Control on a new, separate network**: a
different LAN with its own OneDrive vault, its own workstations and its own
Telegram bot. It doesn't touch any other network you already run. Each network
is defined by its vault, so a new vault means a separate network.

The app is installed as **Agentic Operations Control**, in
`Documents\agentic-operations-control`. Its header, browser tab, Guide and
Telegram messages use that name. It updates from the same GitHub repo as your
other network; only the name, the vault and the network's settings differ.

A few behind-the-scenes names stay as they are, because the update and health
checks look for them: the Windows scheduled task (*Mission Control Watchdog*)
and the firewall rule (*Mission Control LAN link*).

## What's in this folder

| File | What it's for |
|---|---|
| `1 - First machine - Start a new network.cmd` | Run on the **first PC** of the new network. Creates the new vault and makes this PC the network's primary. |
| `2 - Add a machine to this network.cmd` | Run on **every other PC** once the vault has synced to it. Also updates, modifies or uninstalls later. |
| `AgenticOperationsControlSetup.exe` | The same installer as a single .exe. At the vault step, type **N** to start a new network, or pick the synced vault to join one. |
| `install.ps1`, `pick-installer.ps1` | Used by the two .cmd files. Each run uses the newer of this copy and GitHub's. |
| `agentic-operations-control-logo.png` / `.svg`, `agentic-operations-control.ico` | App logo and icon. |

Windows may warn "Windows protected your PC" because the files aren't
code-signed. Click **More info**, then **Run anyway**.

## Before you start

1. **A Microsoft account with OneDrive** for the new network. It can be a
   personal OneDrive or a work/school OneDrive or SharePoint library.
2. **Telegram** on your phone, if you want messages from the network. You'll
   create a new bot (step 3 below).
3. All PCs on the new LAN, signed in to Windows. Claude Code sign-in happens in
   the browser during the install.

## 1. First machine (becomes the primary)

1. Sign in to **OneDrive** on this PC, as the account that will own the new vault.
2. Double-click **`1 - First machine - Start a new network.cmd`**.
3. **Choose what to install**: tick the optional parts you want (Ollama,
   Codex, Hermes, OpenClaw, LAN link). OpenClaw is only needed if you want
   to *reply* from Telegram.
4. **Vault**: the installer lists your OneDrive folders, including synced
   SharePoint libraries. Pick one and name the vault folder (default
   *Agentic Operations Control Vault*). It creates the folder and an `Agentic OS` folder inside.
5. **New network settings**:
   - **Network name**, e.g. *Office LAN*.
   - **Your name**: the agents work for this person.
   - **App name** and **subtitle**: shown in the header and the browser tab.
     Press Enter to keep *AGENTIC OPERATIONS CONTROL / LOCAL AI OPERATIONS DECK*.
   - **Telegram**: see step 3 below. You can also skip it and do it in the app.
6. **Machine group**: the display name for this PC. Its role defaults to **primary**.
7. Windows asks once to allow the firewall change for the LAN link. Click **Yes**.
8. **Phone access** (optional): say yes to use the app from your phone over
   the same Wi-Fi, and choose a PIN (6+ characters, typed hidden). Then open
   `http://<this PC's LAN IP>:3101/` on the phone. Skip it if you like; it's
   also in **Settings → Phone access**, per machine.
9. Agentic Operations Control opens in your browser at http://127.0.0.1:3000.

Optional: in Obsidian, choose *Open folder as vault*, then the new vault folder.

## 2. Every other machine

1. **Give it the vault.**
   - **Same Microsoft account**: sign in to OneDrive; the vault is already there.
   - **Different account**: on the first PC, right-click the vault folder,
     choose **Share**, and give that person edit access. On the new PC, open
     OneDrive on the web, go to **Shared**, find the vault folder and choose
     **Add shortcut to My files**.
2. Wait until the **`Agentic OS`** folder appears in File Explorer. Then
   right-click the vault folder and choose **Always keep on this device**.
3. Double-click **`2 - Add a machine to this network.cmd`**.
4. At the vault step, pick the new vault. If it isn't listed, paste its path.
5. **Role**:
   - **workstation**: never runs scheduled jobs.
   - **backup**: takes over jobs while the primary is down.

   Only one machine should be primary.

## 3. Telegram bot (set up in the installer or the app)

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. It
   replies with a **bot token** like `123456789:ABC...`.
2. Paste the token into the installer, or into the app under
   **Settings → This network → Telegram**.
3. Open your new bot in Telegram and press **Start**, or send it any message.
4. In the installer, press Enter when asked. In the app, click **Find my chat**.
   Pick your chat, then **Save**.
5. Click **Send test**. A message should arrive in Telegram.

The token is stored in the network's vault, so whichever machine takes over as
master can send messages. To **reply** from your phone (approvals, chatting
with agents), install **OpenClaw** on the primary and pair it with this same
bot during `openclaw onboard`. Only one machine may run the gateway for a bot.

## Settings you can change later in the app

Go to **Settings → This network**. Changes apply to every machine in the network:

| Setting | Used for |
|---|---|
| Network name | Shown on the settings page and in test messages |
| Your name | Agent prompts ("you work for ...") |
| App name / subtitle | Header and browser tab |
| Name in text | The Guide, Telegram messages and agent prompts (*Agentic Operations Control*) |
| Telegram bot token + chat | Scheduled reports, alerts, health warnings |
| Vault on this machine | Switch this PC to another vault, or *Create a new vault here*, then **Restart now** |

Per-machine settings are elsewhere:

| Setting | Where |
|---|---|
| This PC's name and role | **Settings → Machine Group & Roles** |
| LAN or Off-LAN | **Fleet → Network** |
| Phone access (PIN, signed-in phones) | **Settings → Phone access** |
| Answer Claude Code permission prompts from the app | **Fleet → Session alerts** (whole network); to answer for another machine, **Fleet → Sharing → Replies from my other machines** on that machine |
| API keys | **Settings → API Keys** and **Settings → LLM Connections** (each machine keeps its own `.env.local`) |

Scheduled missions are kept per machine and run on the master. Create them
on the primary under **Missions → On a schedule**.

## Good to know

- Nothing here changes your other networks. A machine belongs to whichever
  vault its `VAULT_DIR` points at, which the installer sets.
- To move a machine from one network to another, run the installer again and
  choose **Modify**, then the vault. Or in the app, go to
  **Settings → This network → Vault on this machine**, then **Restart now**.
- In the app, the **Guide** has a page called **Set Up a New Network** with the
  same steps, and a **Remote Control** page about live sessions, permission
  prompts and phone access.
