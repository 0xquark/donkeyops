"""
CLI Entrypoint for DonkeyOps.
"""
import argparse
import os
import sys
from dotenv import load_dotenv
from .core import check_stale_prs, check_failing_test_prs
from .auth import get_github_client

# Load .env if present
load_dotenv()

def main():
    parser = argparse.ArgumentParser(description="DonkeyOps GitHub Bot")
    parser.add_argument("--action", choices=["stale", "failing-tests"], required=True)
    parser.add_argument("--repo", required=True, help="Repository name (e.g. rucio/rucio)")
    
    # Auth arguments (can also be set via ENV)

    # Arguments when registering as an app on github
    parser.add_argument("--app-id", default=os.getenv("APP_ID"), help="GitHub App ID")
    parser.add_argument("--private-key", default=os.getenv("PRIVATE_KEY"), help="GitHub App Private Key (or path to file)")
    
    # Arguments when using a personal access token (used for testing)
    parser.add_argument("--token", default=os.getenv("GITHUB_TOKEN"), help="Personal Access Token or Action Token")
    
    args = parser.parse_args()
    
    # Prepare Private Key (handle file path vs content)
    private_key = args.private_key
    if private_key and os.path.isfile(private_key):
        with open(private_key, 'r') as f:
            private_key = f.read()

    try:
        gh = get_github_client(
            app_id=args.app_id, 
            private_key=private_key, 
            token=args.token,
            repo_name=args.repo
        )
    except Exception as e:
        print(f"Authentication Error: {e}")
        sys.exit(1)

    if args.action == "stale":
        check_stale_prs(gh, args.repo)
    elif args.action == "failing-tests":
        check_failing_test_prs(gh, args.repo)
    else:
        print(f"Action '{args.action}' not implemented yet")

if __name__ == "__main__":
    main()
