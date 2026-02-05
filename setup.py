from setuptools import setup, find_packages

setup(
    name="donkeyops",
    version="0.1.0",
    description="Rucio GitHub Bot for PR maintenance",
    author="Rucio",
    packages=find_packages(),
    install_requires=[
        "PyGithub>=2.1.1",
        "python-dotenv>=1.0.0",
        "requests>=2.31.0",
        "cryptography>=41.0.0",  # Required for GitHub App signing if not using built-in
    ],
    entry_points={
        "console_scripts": [
            "donkeyops=donkeyops.cli:main",
        ],
    },
    python_requires=">=3.9",
)
