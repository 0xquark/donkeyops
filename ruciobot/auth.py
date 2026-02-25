"""
Authentication helpers for RucioBot.
"""

import os

from github import Github, GithubIntegration
from github.Auth import AppAuth


def get_app_auth(app_id: str, private_key: str) -> GithubIntegration:
    """
    Returns a GithubIntegration object authenticated as an App.
    """
    if not app_id or not private_key:
        raise ValueError("APP_ID and PRIVATE_KEY are required for App authentication")

    auth = AppAuth(app_id=app_id, private_key=private_key)
    return GithubIntegration(auth=auth)


def get_installation_client(app_id: str, private_key: str, repo_name: str) -> Github:
    """
    Returns a Github client authenticated for a specific repository installation.
    Auto-detects the installation ID for the given repo.
    """
    integration = get_app_auth(app_id, private_key)

    try:
        # Split repo_name into owner and repo
        owner, repo = repo_name.split("/")
        installation = integration.get_repo_installation(owner, repo)
    except Exception as e:
        print(f"Error finding installation for repo {repo_name}: {e}")
        # Fallback or re-raise depending on strictness.
        # If the app isn't installed on the repo, we can't do anything.
        raise e

    # Create a Github client using the installation token
    # PyGithub's GithubIntegration.get_github_for_installation returns a Github client
    # authenticated as that installation only.
    return integration.get_github_for_installation(installation.id)


def get_github_client(
    app_id: str | None = None,
    private_key: str | None = None,
    token: str | None = None,
    repo_name: str | None = None,
) -> Github:
    """
    Factory function to get the best available Github client.
    Prioritizes App authentication if credentials are provided.
    Fallbacks to Token auth.
    """
    # 1. Try App Auth if credentials exist and we know the target repo
    if app_id and private_key and repo_name:
        try:
            return get_installation_client(app_id, private_key, repo_name)
        except Exception as e:
            print(f"Failed to authenticate as App: {e}")
            print("Falling back to Token auth if available...")

    # 2. Try Token Auth
    if token:
        return Github(token)

    # 3. Fallback to extracting token from Environment if not passed explicitly
    env_token = os.getenv("GITHUB_TOKEN")
    if env_token:
        return Github(env_token)

    raise ValueError("No valid credentials found (APP_ID/PRIVATE_KEY or GITHUB_TOKEN)")
