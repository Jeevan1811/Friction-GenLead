"""One-time script to authorize Friction GenLead's Google Sheets access.

Run this once locally: python authorize_sheets.py
It opens your browser for a Google consent screen, then saves a reusable
token file. The backend server uses that saved token afterward -- it never
runs this interactive flow itself.

This is the alternative to a service-account JSON key, for Google Cloud
accounts where org policy blocks service-account key creation
(``iam.disableServiceAccountKeyCreation``, common on personal-account
projects under Google's secure-by-default baseline). You'll need an
OAuth 2.0 Client ID of type "Desktop app" downloaded from Cloud Console ->
APIs & Services -> Credentials first.
"""

import os
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def main() -> None:
    client_secret_path = os.getenv(
        "GOOGLE_OAUTH_CLIENT_SECRET_PATH", "credentials/oauth_client_secret.json"
    )
    token_path = os.getenv("GOOGLE_OAUTH_TOKEN_PATH", "credentials/oauth_token.json")

    if not os.path.exists(client_secret_path):
        print(f"Client secret file not found at: {client_secret_path}")
        print("Download it from Google Cloud Console -> APIs & Services -> Credentials")
        print("(create an OAuth client ID of type 'Desktop app'), then set")
        print("GOOGLE_OAUTH_CLIENT_SECRET_PATH in your .env or pass it directly.")
        sys.exit(1)

    os.makedirs(os.path.dirname(token_path) or ".", exist_ok=True)

    flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
    creds = flow.run_local_server(port=0)

    with open(token_path, "w") as f:
        f.write(creds.to_json())

    print(f"Authorized. Token saved to: {token_path}")
    print("You can now start the backend normally -- it will use this token.")


if __name__ == "__main__":
    main()
