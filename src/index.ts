import { Probot } from "probot";
import yaml from "js-yaml";

// Default valid types for conventional commits
const DEFAULT_TYPE_ENUM = [
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test'
];

// Default valid components from Rucio's labels
const DEFAULT_VALID_COMPONENTS = [
  "Testing",
  "Clients", 
  "Core",
  "WebUI",
  "Database",
  "API",
  "Documentation",
  "Infrastructure",
  "Security",
  "Performance",
  "Monitoring",
  "Deployment",
  "CI/CD",
  "Dependencies",
  "Bug Fix",
  "Feature",
  "Enhancement",
  "Core & Internals",
  "Refactoring"
];

const DEFAULT_COMMIT_FORMAT = "<type>(<component>): <short_message> #<issue_number>";

interface DonkeyOpsConfig {
  conventional_commits?: {
    type_enum?: string[];
    valid_components?: string[];
    require_issue_number?: boolean;
    commit_format?: string;
    enabled?: boolean;
  };
}

interface CommitValidationResult {
  isValid: boolean;
  warning?: string;
  suggestion?: string;
}

async function getDonkeyOpsConfig(context: any): Promise<DonkeyOpsConfig> {
  try {
    const configFile = await context.octokit.repos.getContent({
      owner: context.payload.repository.owner.login,
      repo: context.payload.repository.name,
      path: ".donkeyops.yml",
      ref: context.payload.pull_request?.head?.sha || context.payload.pull_request?.base?.sha || context.payload.ref,
    });
    // GitHub API returns content as base64
    const content = Buffer.from((configFile.data.content || ""), "base64").toString();
    return yaml.load(content) as DonkeyOpsConfig;
  } catch (e) {
    // If file not found, return empty config (use defaults)
    return {};
  }
}

function validateCommitMessage(
  commitMessage: string,
  typeEnum: string[],
  validComponents: string[],
  commitFormat: string
): CommitValidationResult {
  // Remove any leading/trailing whitespace
  const trimmedMessage = commitMessage.trim();

  // Regex for <type>(<component>): <short_message> #<issue_number>
  const conventionalCommitRegex = /^([a-zA-Z\-]+)\(([^)]+)\):\s+(.+?)\s+#(\d+)$/i;
  const match = trimmedMessage.match(conventionalCommitRegex);

  if (!match) {
    const suggestion = `Please format your commit message as: "${commitFormat}"`;
    const warning = `⚠️ **Conventional Commit Warning**\n\nThis commit doesn't follow the conventional commit format.\n\n**Expected format:** \`${commitFormat}\`\n\n**Valid types:** ${typeEnum.join(', ')}\n**Valid components:** ${validComponents.join(', ')}\n\n**Suggestion:** ${suggestion}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    return {
      isValid: false,
      warning,
      suggestion
    };
  }

  const [ , type, component ] = match;

  // Check if the type is valid (case insensitive)
  const isValidType = typeEnum.some(
    validType => validType.toLowerCase() === type.toLowerCase()
  );
  if (!isValidType) {
    const suggestion = `Please use one of the valid types: ${typeEnum.join(', ')}`;
    const warning = `⚠️ **Invalid Type Warning**\n\nType "${type}" is not recognized.\n\n**Valid types:** ${typeEnum.join(', ')}\n\n**Suggestion:** ${suggestion}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    return {
      isValid: false,
      warning,
      suggestion
    };
  }

  // Check if the component is valid (case insensitive)
  const isValidComponent = validComponents.some(
    validComponent => validComponent.toLowerCase() === component.toLowerCase()
  );
  if (!isValidComponent) {
    const suggestion = `Please use one of the valid components: ${validComponents.join(', ')}`;
    const warning = `⚠️ **Invalid Component Warning**\n\nComponent "${component}" is not recognized.\n\n**Valid components:** ${validComponents.join(', ')}\n\n**Suggestion:** ${suggestion}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    return {
      isValid: false,
      warning,
      suggestion
    };
  }

  return { isValid: true };
}

export default (app: Probot) => {
  // Listen to pull request events to check commit messages
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    await checkCommitsInPR(context);
  });

  async function checkCommitsInPR(context: any) {
    const { pull_request, repository } = context.payload;

    // Load config from repo (if present)
    const config = await getDonkeyOpsConfig(context);
    const typeEnum = config.conventional_commits?.type_enum || DEFAULT_TYPE_ENUM;
    const validComponents = config.conventional_commits?.valid_components || DEFAULT_VALID_COMPONENTS;
    const commitFormat = config.conventional_commits?.commit_format || DEFAULT_COMMIT_FORMAT;
    const enabled = config.conventional_commits?.enabled !== false; // default true

    if (!enabled) {
      return; // skip validation if disabled
    }

    try {
      // Get the commits for this PR
      const { data: commits } = await context.octokit.pulls.listCommits({
        owner: repository.owner.login,
        repo: repository.name,
        pull_number: pull_request.number,
      });

      const invalidCommits: Array<{ sha: string; message: string; validation: CommitValidationResult }> = [];

      // Validate each commit
      for (const commit of commits) {
        const validation = validateCommitMessage(commit.commit.message, typeEnum, validComponents, commitFormat);
        if (!validation.isValid) {
          invalidCommits.push({
            sha: commit.sha.substring(0, 7),
            message: commit.commit.message,
            validation
          });
        }
      }

      // If there are invalid commits, create a comment
      if (invalidCommits.length > 0) {
        let commentBody = `## 🔍 Conventional Commit Check\n\n`;
        commentBody += `Found ${invalidCommits.length} commit(s) that don't follow the conventional commit format:\n\n`;

        invalidCommits.forEach(({ sha, message, validation }) => {
          commentBody += `### Commit \`${sha}\`\n`;
          commentBody += `**Message:** \`${message}\`\n\n`;
          commentBody += `${validation.warning}\n\n`;
          commentBody += `---\n\n`;
        });

        commentBody += `**Note:** Please update your commits to follow the conventional format before merging.`;

        const comment = context.issue({
          body: commentBody,
        });

        await context.octokit.issues.createComment(comment);
      }
    } catch (error) {
      console.error('Error checking commits:', error);
    }
  }
};
