import { Probot } from "probot";
import yaml from "js-yaml";
import fetch from "node-fetch";

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
  "Refactoring",
  "Docs"
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
  pr_labeling?: {
    enabled?: boolean;
  };
}

interface CommitValidationResult {
  isValid: boolean;
  warning?: string;
}

interface SlashCommand {
  command: string;
  args: string[];
}

interface CodellamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context: number[];
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

interface CodellamaRequest {
  model: string;
  prompt: string;
  stream: boolean;
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
  } catch {
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
    const warning = `⚠️ **Conventional Commit Warning**\n\nThis commit doesn't follow the conventional commit format.\n\n**Expected format:** \`${commitFormat}\`\n\n**Valid types:** ${typeEnum.join(', ')}\n**Valid components:** ${validComponents.join(', ')}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    return {
      isValid: false,
      warning
    };
  }

  const [ , type, component ] = match;

  // Check if the type is valid (case insensitive)
  const isValidType = typeEnum.some(
    validType => validType.toLowerCase() === type.toLowerCase()
  );
  if (!isValidType) {
    const warning = `⚠️ **Invalid Type Warning**\n\nType \"${type}\" is not recognized.\n\n**Valid types:** ${typeEnum.join(', ')}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    return {
      isValid: false,
      warning
    };
  }

  // Check if the component is valid (case insensitive)
  const isValidComponent = validComponents.some(
    validComponent => validComponent.toLowerCase() === component.toLowerCase()
  );
  if (!isValidComponent) {
    const warning = `⚠️ **Invalid Component Warning**\n\nComponent \"${component}\" is not recognized.\n\n**Valid types:** ${typeEnum.join(', ')}\n**Valid components:** ${validComponents.join(', ')}\n\nFor more information, see: https://rucio.github.io/documentation/contributing/`;
    return {
      isValid: false,
      warning
    };
  }

  return { isValid: true };
}

function detectLabelsFromTitle(title: string, validComponents: string[]): string[] {
  const detectedLabels: string[] = [];
  const titleLower = title.toLowerCase();

  // Check for component matches in the title
  for (const component of validComponents) {
    const componentLower = component.toLowerCase();
    
    // Check if the component name appears in the title
    if (titleLower.includes(componentLower)) {
      detectedLabels.push(component);
    }
  }

  return detectedLabels;
}

async function applyLabelsToPR(context: any, labels: string[]): Promise<void> {
  if (labels.length === 0) return;

  try {
    const { pull_request, repository } = context.payload;
    
    // Get current labels to avoid duplicates
    const { data: currentLabels } = await context.octokit.issues.listLabelsOnIssue({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
    });

    const currentLabelNames = currentLabels.map((label: any) => label.name);
    const newLabels = labels.filter(label => !currentLabelNames.includes(label));

    if (newLabels.length > 0) {
      await context.octokit.issues.addLabels({
        owner: repository.owner.login,
        repo: repository.name,
        issue_number: pull_request.number,
        labels: newLabels,
      });
    }
  } catch (error) {
    console.error('Error applying labels to PR:', error);
  }
}

async function getPRDiff(context: any): Promise<string> {
  try {
    const { pull_request, repository } = context.payload;
    const { data: diff } = await context.octokit.pulls.get({
      owner: repository.owner.login,
      repo: repository.name,
      pull_number: pull_request.number,
      mediaType: {
        format: 'diff'
      }
    });
    return diff as string;
  } catch (error) {
    console.error('Error getting PR diff:', error);
    throw error;
  }
}

async function callCodellama(prompt: string): Promise<string> {
  try {
    const requestBody: CodellamaRequest = {
      model: "qwen2.5-coder",
      prompt: prompt,
      stream: false
    };

    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as CodellamaResponse;
    return data.response;
  } catch (error) {
    console.error('Error calling Codellama:', error);
    throw error;
  }
}

async function performCodeReview(context: any): Promise<string> {
  try {
    const { pull_request, repository } = context.payload;
    
    // Get the PR diff
    const diff = await getPRDiff(context);
    
    // Create a prompt for the code review
    const prompt = `Review this code change and provide a concise GitHub Copilot-style code review.

Repository: ${repository.owner.login}/${repository.name}
PR Title: ${pull_request.title}
PR Number: #${pull_request.number}

Instructions:
- Be very concise and direct
- Focus on specific issues, bugs, or improvements
- Provide actionable suggestions with code examples
- Use clear, brief explanations
- Avoid lengthy paragraphs
- If you find issues, suggest specific fixes

Code changes:
${diff}

Provide a brief, actionable code review:`;

    // Call Codellama
    const review = await callCodellama(prompt);
    
    return review;
  } catch (error) {
    console.error('Error performing code review:', error);
    throw error;
  }
}

function parseSlashCommand(body: string): SlashCommand | null {
  
  if (!body || body.trim() === '') {
    return null;
  }
  
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('/donkeyops')) {
      // Split by spaces but preserve quoted strings and @ symbols
      const parts = trimmed.split(' ').filter(part => part.length > 0);
      
      if (parts.length >= 2) {
        return {
          command: parts[1],
          args: parts.slice(2)
        };
      }
    }
  }
  return null;
}

async function handleSlashCommands(context: any): Promise<void> {
  const { issue, repository, comment } = context.payload;
  
  // Try different possible locations for the comment body
  let commentBody = '';
  if (comment && comment.body) {
    commentBody = comment.body;
  } else if (issue && issue.body) {
    commentBody = issue.body;
  }
  
  const command = parseSlashCommand(commentBody);

  if (!command) {
    return;
  }

  try {
    switch (command.command) {
      case 'label': {
        if (command.args.length === 0) {
          await context.octokit.issues.createComment({
            ...context.issue(),
            body: '❌ **Error:** Please specify a label. Usage: `/donkeyops label <label>`'
          });
          return;
        }
        
        const label = command.args[0];
        await context.octokit.issues.addLabels({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          labels: [label],
        });
        break;
      }

      case 'unlabel': {
        if (command.args.length === 0) {
          await context.octokit.issues.createComment({
            ...context.issue(),
            body: '❌ **Error:** Please specify a label. Usage: `/donkeyops unlabel <label>`'
          });
          return;
        }
        
        const labelToRemove = command.args[0];
        await context.octokit.issues.removeLabel({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          name: labelToRemove,
        });
        break;
      }

      case 'close':
        await context.octokit.issues.update({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          state: 'closed',
        });
        break;

      case 'assign': {
        if (command.args.length === 0) {
          await context.octokit.issues.createComment({
            ...context.issue(),
            body: '❌ **Error:** Please specify a reviewer. Usage: `/donkeyops assign <reviewer-username>`'
          });
          return;
        }
        
        const reviewer = command.args[0].replace('@', ''); // Remove @ symbol if present
        await context.octokit.issues.addAssignees({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          assignees: [reviewer],
        });
        break;
      }

      case 'unassign': {
        if (command.args.length === 0) {
          await context.octokit.issues.createComment({
            ...context.issue(),
            body: '❌ **Error:** Please specify a reviewer. Usage: `/donkeyops unassign <reviewer-username>`'
          });
          return;
        }
        
        const reviewerToRemove = command.args[0].replace('@', ''); // Remove @ symbol if present
        await context.octokit.issues.removeAssignees({
          owner: repository.owner.login,
          repo: repository.name,
          issue_number: issue.number,
          assignees: [reviewerToRemove],
        });
        break;
      }

      case 'approve':
        // Approve the PR using GitHub's review API
        await context.octokit.pulls.createReview({
          owner: repository.owner.login,
          repo: repository.name,
          pull_number: issue.number,
          event: 'APPROVE',
          body: 'Approved via /donkeyops approve command'
        });
        break;

      case 'review': {
        try {
          // Check if this is a PR by trying to get PR details
          const { issue, repository } = context.payload;
          
          try {
            // Try to get the PR details to confirm it's a PR
            const { data: pr } = await context.octokit.pulls.get({
              owner: repository.owner.login,
              repo: repository.name,
              pull_number: issue.number,
            });
            
            // If we get here, it's a PR. Create a context with pull_request for the review
            const prContext = {
              ...context,
              payload: {
                ...context.payload,
                pull_request: pr
              }
            };
            
            // Perform the code review
            const review = await performCodeReview(prContext);
            
            // Post the review as a comment
            await context.octokit.issues.createComment({
              ...context.issue(),
              body: `## 🤖 Code Review by DonkeyOps Bot\n\n${review}`
            });
          } catch (prError) {
            // If we can't get PR details, it's probably an issue
            await context.octokit.issues.createComment({
              ...context.issue(),
              body: '❌ **Error:** Code review is only available for pull requests, not issues.'
            });
            return;
          }
        } catch (error) {
          console.error('Error performing code review:', error);
          await context.octokit.issues.createComment({
            ...context.issue(),
            body: '❌ **Error:** Failed to perform code review. Please check if the Qwen2.5-coder service is running locally on port 11434.'
          });
        }
        break;
      }

      default:
        await context.octokit.issues.createComment({
          ...context.issue(),
          body: `❌ **Unknown command:** \`${command.command}\`\n\n**Available commands:**\n- \`/donkeyops label <label>\` - Add a label\n- \`/donkeyops unlabel <label>\` - Remove a label\n- \`/donkeyops close\` - Close issue/PR\n- \`/donkeyops assign <reviewer>\` - Assign reviewer\n- \`/donkeyops unassign <reviewer>\` - Remove reviewer\n- \`/donkeyops approve\` - Approve PR\n- \`/donkeyops review\` - Perform AI code review`
        });
        break;
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    await context.octokit.issues.createComment({
      ...context.issue(),
      body: '❌ **Error:** Failed to execute command. Please check the syntax and try again.'
    });
  }
}

export default (app: Probot) => {
  // Listen to pull request events to check commit messages
  app.on(["pull_request.opened", "pull_request.synchronize"], async (context) => {
    await checkCommitsInPR(context);
  });

  // Listen to pull request events for automatic labeling
  app.on(["pull_request.opened", "pull_request.edited"], async (context) => {
    await autoLabelPR(context);
  });

  // Listen to issue and PR comment events for slash commands
  app.on("issue_comment.created", async (context) => {
    await handleSlashCommands(context);
  });

  app.on("pull_request_review_comment.created", async (context) => {
    await handleSlashCommands(context);
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

  async function autoLabelPR(context: any) {
    const { pull_request, repository } = context.payload;

    // Load config from repo (if present)
    const config = await getDonkeyOpsConfig(context);
    const prLabelingEnabled = config.pr_labeling?.enabled !== false; // default true

    if (!prLabelingEnabled) {
      return; // skip labeling if disabled
    }

    const validComponents = config.conventional_commits?.valid_components || DEFAULT_VALID_COMPONENTS;
    
    // Detect labels from PR title
    let detectedLabels = detectLabelsFromTitle(pull_request.title, validComponents);
    
    // If no labels found in title, check commits for valid components
    if (detectedLabels.length === 0) {
      try {
        const { data: commits } = await context.octokit.pulls.listCommits({
          owner: repository.owner.login,
          repo: repository.name,
          pull_number: pull_request.number,
        });

        // Extract components from conventional commit messages
        const commitComponents = new Set<string>();
        for (const commit of commits) {
          const conventionalCommitRegex = /^([a-zA-Z\-]+)\(([^)]+)\):\s+(.+?)\s+#(\d+)$/i;
          const match = commit.commit.message.match(conventionalCommitRegex);
          if (match) {
            const [, , component] = match;
            // Check if the component is valid (case insensitive)
            const isValidComponent = validComponents.some(
              validComponent => validComponent.toLowerCase() === component.toLowerCase()
            );
            if (isValidComponent) {
              // Find the exact case from validComponents
              const exactComponent = validComponents.find(
                validComponent => validComponent.toLowerCase() === component.toLowerCase()
              );
              if (exactComponent) {
                commitComponents.add(exactComponent);
              }
            }
          }
        }
        
        detectedLabels = Array.from(commitComponents);
      } catch (error) {
        console.error('Error checking commits for components:', error);
      }
    }
    
    // Apply labels to PR
    await applyLabelsToPR(context, detectedLabels);
  }
};
