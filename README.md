# Schoool v1

A multi-user school social site designed for GitHub Pages + Supabase.

## Features

- Homemade signup CAPTCHA
- Username + password account creation
- Username + password login
- Home dashboard
- Global Chat
- Friends + friend requests
- Private DMs between friends
- Friend Groups
- Group invitations
- Group chat + member list
- Settings:
  - Change password
  - Light / dark / system theme
  - Background style
  - Font family
  - Font size
  - Font color
  - Accent color
- Realtime chat using Supabase Realtime
- Row Level Security (RLS) so users only see data they're allowed to see

## Important security note

The homemade CAPTCHA is only a lightweight anti-spam challenge.
Because its logic runs in the browser, a determined bot can bypass it.
It is NOT equivalent to Cloudflare Turnstile, hCaptcha, or reCAPTCHA.

Passwords are NOT stored in Schoool's database tables.
Supabase Auth hashes/manages passwords.

## Step 1 — Create the GitHub repository

Create a new repository named:

`Schoool`

Upload the contents of this folder to the repository root:

- index.html
- styles.css
- app.js
- config.js
- .nojekyll

You can also upload README.md and supabase_schema.sql, though they are not needed by the live website.

Then enable:

Settings → Pages → Deploy from a branch → main → /(root)

Your website should become:

`https://ziqiancode.github.io/Schoool/`

The frontend uses relative paths, so it is safe to host inside the `/Schoool/` GitHub Pages subfolder.

## Step 2 — Create a Supabase project

Create a Supabase project.

Then open the Supabase SQL Editor and run the entire contents of:

`supabase_schema.sql`

This creates the database tables, triggers, Realtime configuration, and RLS security policies.

## Step 3 — IMPORTANT: Disable email confirmation

Schoool gives users a username/password interface, not an email interface.

Internally it maps:

`username` → `username@schoool.local`

Because that is not a real mailbox, Supabase email confirmation MUST be disabled.

In Supabase Authentication settings, disable the option that requires users to confirm their email before signing in.

The exact dashboard wording may change, but look for the Email provider / Confirm email setting.

## Step 4 — Add your Supabase public keys

In Supabase, find:

- Project URL
- anon / public API key

Open `config.js` and paste them:

```js
window.SCHOOOL_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR_ANON_KEY"
};
```

The anon/public key is intended to be used in a browser app.

NEVER put the `service_role` key in config.js or GitHub.

Commit the updated `config.js` to GitHub.

## Step 5 — Test with two accounts

Use two browsers, two Edge profiles, or an incognito window.

Test:

1. Create Account A
2. Create Account B
3. Send a friend request
4. Accept it
5. Send a DM
6. Create a friend group
7. Invite the other account
8. Accept the group invite
9. Send group messages
10. Test Global Chat

## Username rules

Usernames are:

- 3–24 characters
- lowercase letters
- numbers
- underscore `_`

Examples:

- `ziqian`
- `math_guy12`
- `chessmaster`

## Files

- `index.html` — website UI
- `styles.css` — design/themes/responsive layout
- `app.js` — login/chat/friends/groups/settings logic
- `config.js` — your Supabase public configuration
- `supabase_schema.sql` — database + security setup
- `.nojekyll` — makes GitHub Pages serve the files directly

## Things I would add in v2

If Schoool gets more than a small friend group, add:

- Moderators/admin roles
- Report / block user features
- Message deletion UI
- Rate limiting / anti-spam
- Server-side CAPTCHA or Turnstile
- Profile pictures
- Unread message counts
- Notifications
- Group owners removing members
- Password reset/recovery strategy

A static browser CAPTCHA and client-side controls are not sufficient protection for a large public community.
