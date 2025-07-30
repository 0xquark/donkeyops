import { Probot } from "probot";

// Valid components from Rucio's labels (https://github.com/rucio/rucio/labels)
const VALID_COMPONENTS = [
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

interface CommitValidationResult {
  isValid: boolean;
  warning?: string;
  suggestion?: string;
}

function validateCommitMessage(commitMessage: string): CommitValidationResult {
  // Remove any leading/trailing whitespace
  const trimmedMessage = commitMessage.trim();
  
  // Check if the message follows the pattern: <component>: <change_message> #<issue_number>
  const conventionalCommitRegex = /^([^:]+):\s+(.+?)\s+#(\d+)$/i;
  const match = trimmedMessage.match(conventionalCommitRegex);
  
  if (!match) {
    const suggestion = `Please format your commit message as: "<component>: <change_message> #<issue_number>"`;
    const warning = `⚠️ **Conventional Commit Warning**\n\nThis commit doesn't follow the conventional commit format.\n\n**Expected format:** \`<component>: <change_message> #<issue_number>\`\n\n**Valid components:** ${VALID_COMPONENTS.join(', ')}\n\n**Suggestion:** ${suggestion}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    
    return {
      isValid: false,
      warning,
      suggestion
    };
  }
  
  const [, component] = match;
  
  // Check if the component is valid (case insensitive)
  const isValidComponent = VALID_COMPONENTS.some(
    validComponent => validComponent.toLowerCase() === component.toLowerCase()
  );
  
  if (!isValidComponent) {
    const suggestion = `Please use one of the valid components: ${VALID_COMPONENTS.join(', ')}`;
    const warning = `⚠️ **Invalid Component Warning**\n\nComponent "${component}" is not recognized.\n\n**Valid components:** ${VALID_COMPONENTS.join(', ')}\n\n**Suggestion:** ${suggestion}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    
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
  app.on("pull_request.opened", async (context) => {
    await checkCommitsInPR(context);
  });

  app.on("pull_request.synchronize", async (context) => {
    await checkCommitsInPR(context);
  });

  async function checkCommitsInPR(context: any) {
    const { pull_request, repository } = context.payload;
    
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
        const validation = validateCommitMessage(commit.commit.message);
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

  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
};
