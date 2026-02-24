from setuptools import setup, find_packages

setup(
    name="ruciobot",
    version="0.1.0",
    description="Rucio GitHub Bot for PR maintenance",
    author="Rucio",
    packages=find_packages(),
    install_requires=[
        "PyGithub>=2.8.1",
        "python-dotenv>=1.2.1",
        "requests>=2.32.5",
        "cryptography>=46.0.0",  # Required for GitHub App signing if not using built-in
    ],
    entry_points={
        "console_scripts": [
            "ruciobot=ruciobot.cli:main",
        ],
    },
    extras_require={
        "dev": ["pytest>=8.0.0"],
    },
    python_requires=">=3.12",
)
