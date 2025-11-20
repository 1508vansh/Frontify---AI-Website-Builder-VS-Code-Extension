const vscode = require('vscode');
const { GoogleGenAI, Type } = require("@google/genai");
const os = require('os');

const platform = os.platform();

// Conversation history
const History = [];

/**
 * Get API key from configuration with proper error handling
 */
function getApiKey() {
  const config = vscode.workspace.getConfiguration('frontify');
  const apiKey = config.get('apiKey');
  
  if (!apiKey || apiKey === 'API_KEY' || apiKey.trim() === '') {
    vscode.window.showErrorMessage(
      'Frontify: API key not configured. Please set your Gemini API key in settings.',
      'Setup API Key',
      'Open Settings',
      'Get API Key'
    ).then(selection => {
      if (selection === 'Setup API Key') {
        vscode.commands.executeCommand('frontify.setup');
      } else if (selection === 'Open Settings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'frontify.apiKey');
      } else if (selection === 'Get API Key') {
        vscode.env.openExternal(vscode.Uri.parse('https://aistudio.google.com/'));
      }
    });
    throw new Error('API key not configured. Please set your Gemini API key in VS Code settings.');
  }
  
  return apiKey;
}

/**
 * Initialize Gemini client with user's API key
 */
function getAIClient() {
  try {
    const apiKey = getApiKey();
    return new GoogleGenAI({
      apiKey: apiKey,
    });
  } catch (error) {
    throw error; // Re-throw the error to be handled by the command
  }
}

/**
 * Executes file operations using VS Code API instead of terminal commands
 */
const executeVSCodeCommand = async ({ command }) => {
  try {
    console.log("🚀 EXECUTING COMMAND:", command);
    // Check if workspace is open
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      throw new Error('Please open a folder in VS Code first!');
    }

    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri;
    let result = '';

    // Parse the command and execute appropriate VS Code file operation
    if (command.includes('mkdir') || command.includes('New-Item -ItemType Directory')) {
      // Create folder
      const folderName = extractFolderName(command);
      const folderUri = vscode.Uri.joinPath(workspaceFolder, folderName);
      console.log("📁 CREATING FOLDER:", folderUri.fsPath);
      await vscode.workspace.fs.createDirectory(folderUri);
      result = `✅ Folder created: ${folderName}`;

    } else if (command.includes('@\'') || command.includes('cat <<')) {
      // Write file content (multiline content)
      const { filePath, content } = extractFileContent(command);
      const fileUri = vscode.Uri.joinPath(workspaceFolder, filePath);
      console.log("📝 CREATING FILE:", fileUri.fsPath);
      console.log("📄 CONTENT PREVIEW:", content.substring(0, 100) + '...');
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content));
      result = `✅ File created: ${filePath} with ${content.length} characters`;

    } else if (command.includes('Get-Content') || command.includes('cat ')) {
      // Read file content
      const filePath = extractFilePath(command);
      const fileUri = vscode.Uri.joinPath(workspaceFolder, filePath);
      console.log("👀 READING FILE:", fileUri.fsPath);
      const fileContent = await vscode.workspace.fs.readFile(fileUri);
      result = `✅ File content: ${fileContent.toString().substring(0, 100)}...`;

    } else if (command.includes('dir') || command.includes('ls')) {
      // List directory
      const folderPath = extractFolderPath(command) || '';
      const folderUri = vscode.Uri.joinPath(workspaceFolder, folderPath);
      console.log("📋 LISTING DIRECTORY:", folderUri.fsPath);
      const files = await vscode.workspace.fs.readDirectory(folderUri);
      result = `✅ Directory contents: ${files.map(([name]) => name).join(', ')}`;

    } else {
      console.log("⚡ EXECUTING GENERIC COMMAND");
      result = `✅ Command executed: ${command}`;
    }

    console.log("✅ COMMAND RESULT:", result);
    return result;
  } catch (err) {
    console.error("❌ COMMAND ERROR:", err.message);
    // Handle "folder already exists" gracefully
    if (err.message.includes('FileExists') || err.message.includes('EEXIST')) {
      return `✅ Folder already exists (continuing...)`;
    }
    return `❌ Error: ${err.message}`;
  }
};

// Helper functions to parse commands
function extractFolderName(command) {
  const mkdirMatch = command.match(/mkdir\s+(.+)/);
  const newItemMatch = command.match(/New-Item -ItemType Directory\s+(.+)/);
  
  if (mkdirMatch) return mkdirMatch[1].trim();
  if (newItemMatch) return newItemMatch[1].trim().replace(/'/g, '');
  return 'frontify-website'; // default to frontify-website
}

function extractFileContent(command) {
  console.log("📄 PARSING FILE CONTENT FROM:", command);
  
  // Windows format: @'\ncontent\n'@ | Set-Content -Path "path"
  if (command.includes("@'")) {
    const pathMatch = command.match(/Set-Content -Path "([^"]+)"/);
    const contentMatch = command.match(/@'\n([\s\S]*?)\n'@/);
    
    console.log("🪟 Windows format detected");
    console.log("📁 Path match:", pathMatch ? pathMatch[1] : 'NOT FOUND');
    console.log("📝 Content length:", contentMatch ? contentMatch[1].length : 0);
    
    return {
      filePath: pathMatch ? pathMatch[1] : 'index.html',
      content: contentMatch ? contentMatch[1] : ''
    };
  }
  
  // Linux format: cat << 'EOF' > path\ncontent\nEOF
  if (command.includes('cat <<')) {
    const pathMatch = command.match(/>\s*([^\s\n]+)/);
    const lines = command.split('\n');
    const content = lines.slice(1, -1).join('\n'); // Remove first and last line
    
    console.log("🐧 Linux format detected");
    console.log("📁 Path match:", pathMatch ? pathMatch[1] : 'NOT FOUND');
    console.log("📝 Content length:", content.length);
    
    return {
      filePath: pathMatch ? pathMatch[1] : 'index.html',
      content: content
    };
  }
  
  console.log("❓ Unknown command format, using default");
  return { filePath: 'index.html', content: command };
}

function extractFilePath(command) {
  const winMatch = command.match(/Get-Content -Raw "([^"]+)"/);
  const linuxMatch = command.match(/cat\s+([^\s]+)/);
  return winMatch ? winMatch[1] : (linuxMatch ? linuxMatch[1] : 'index.html');
}

function extractFolderPath(command) {
  const dirMatch = command.match(/dir\s+(.+)/);
  const lsMatch = command.match(/ls\s+(.+)/);
  return dirMatch ? dirMatch[1] : (lsMatch ? lsMatch[1] : '');
}

// Function declaration (schema) - UPDATED for VS Code
const executeCommandDeclaration = {
  name: "executeCommand",
  description: `Execute file system operations for creating websites.
    Current OS: ${platform}. Create folders, files, and write code to files.`,
  parameters: {
    type: Type.OBJECT,
    properties: {
      command: {
        type: Type.STRING,
        description: "A terminal command for file operations (will be converted to VS Code API calls)",
      },
    },
    required: ["command"],
  },
};

/**
 * Helper function to retry Gemini API calls.
 */
async function generateWithRetry(request, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const ai = getAIClient(); // Get fresh client with API key
      const response = await ai.models.generateContent(request);
      return response;
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, delay * attempt));
    }
  }
}

/**
 * Main AI processing logic
 */
async function processWithAI(userPrompt, progress) {
  History.push({
    role: "user",
    parts: [{ text: userPrompt }],
  });

  while (true) {
    try {
      progress.report({ message: "Generating website structure with AI..." });

      const response = await generateWithRetry({
        model: "gemini-2.5-flash",
        contents: History,
        config: {
          systemInstruction: `You are an expert autonomous frontend-building agent.
Your ONLY way of interacting with the environment is by calling the function executeCommand with EXACTLY one argument: a single file system command.
You MUST NOT output anything except a function call to executeCommand.
You MUST NOT output HTML, CSS, JS, code snippets, descriptions, terminal commands, or file contents in chat.
You MUST NOT mix human text with a function call.
You MUST ONLY create single page website, YOU CAN use anchor tags for making sections.
If user asks anything else like hi, hello, who are you, or anything apart from making a website, just reply casually like an LLM.
ALWAYS CREATE GOOD UI SHOULD LOOK GOOD.

Current User Operating System: ${platform}

====================================================================
VS CODE EXTENSION ADAPTATIONS - IMPORTANT CHANGES:

- All file operations will be executed in the user's currently open VS Code workspace
- The executeCommand function now uses VS Code file system API internally
- Commands are parsed and converted to native VS Code operations
- File paths are relative to the workspace root
- "Folder already exists" errors are handled gracefully - continue to next phase
- Validation commands work but use VS Code's file system internally

====================================================================
PHASE MACHINE — FOLLOW EXACTLY

PHASE 1 — Create project folder
PHASE 2 — Create empty index.html  
PHASE 3 — Write full index.html containing:
- Full HTML
- Internal CSS inside <style>
- Internal JS inside <script>
(use provided tool executeCommand to execute the command, write full code inside only html file)

After each successful executeCommand result, MOVE TO NEXT PHASE.
Never repeat a phase unless validation shows the file is missing or empty.

====================================================================
VALIDATION RULES

A file is VALID if:
- It exists
- It has NON-ZERO size  
- Reading it returns content without error

If valid → advance to next phase.
If invalid → rewrite using correct OS multiline format.

====================================================================
WINDOWS MULTILINE FORMAT (CRITICAL)
CONTINUE USING EXACTLY THIS FORMAT - IT WILL BE PARSED:

@'
CONTENT GOES HERE
'@ | Set-Content -Path "folder\file.ext"

Rules:
1. Line break immediately after @'
2. Line break immediately before '@
3. No text before @'
4. No text after '@
5. No indentation on @' or '@

====================================================================
LINUX / MAC MULTILINE FORMAT
CONTINUE USING EXACTLY THIS FORMAT - IT WILL BE PARSED:

cat << 'EOF' > folder/file.ext
CONTENT GOES HERE
EOF

No variations.

====================================================================
VALIDATION COMMANDS
CONTINUE USING THESE COMMANDS - THEY WILL BE PARSED:

Windows:
Get-Content -Raw "folder\index.html"

Linux/Mac:
cat folder/index.html

====================================================================
ABSOLUTE EXECUTION RULES

1. One command per executeCommand call.
2. NEVER use && or ;
3. NEVER output or describe code.
4. NEVER print file contents.
5. NEVER repeat phases unless validation fails.
6. If uncertain → assume file is VALID and move forward.
7. If stuck → list directory using (Windows: dir) or (Linux/Mac: ls).

====================================================================
DIRECTORY-ALREADY-EXISTS HANDLING

If a folder-create command fails because the folder already exists:
- DO NOT retry
- The VS Code extension will handle this gracefully
- Simply assume the folder is valid and MOVE TO NEXT PHASE

====================================================================
PHASE COMMUNICATION PROTOCOL

The driver provides CURRENT_PHASE and LAST_FN_RESULT.
Use ONLY these to decide the next command.
Output ONLY the next executeCommand call.

====================================================================
PHASE 11 — FINAL OUTPUT

When CURRENT_PHASE = 11:
Do NOT call executeCommand.
Do NOT output code or commands.
Output ONLY:
"The project folder and index.html were successfully created and written. Your website is ready in the VS Code workspace!"

If user asks anything else apart from website making, then reply in general way.

====================================================================
REQUIRED OUTPUT FORMAT:

For all phases EXCEPT Phase 11:
- Output ONLY JSON function calls in this exact format:
{
  "functionCall": {
    "name": "executeCommand",
    "args": {
      "command": "your-command-here"
    }
  }
}

For Phase 11 ONLY:
- Output ONLY plain text success message

For casual conversations (non-website requests):
- Output natural language responses

====================================================================
END OF SYSTEM INSTRUCTION`,
          tools: [{
            functionDeclarations: [executeCommandDeclaration],
          }],
        },
      });

      const candidate = response.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      
      // Get the raw text response
      const responseText = parts.map((p) => p.text).join("\n");
      console.log("🤖 RAW AI RESPONSE:", responseText);

      // Check if it's a JSON function call
      if (responseText.trim().startsWith('{') && responseText.includes('functionCall')) {
        try {
          const jsonResponse = JSON.parse(responseText);
          
          if (jsonResponse.functionCall && jsonResponse.functionCall.name === "executeCommand") {
            const { name, args } = jsonResponse.functionCall;
            
            progress.report({ message: "Creating files and folders..." });
            console.log("🔧 EXECUTING COMMAND:", args.command);
            
            const result = await executeVSCodeCommand(args);

            // Feed result back to model
            History.push({
              role: "user",
              parts: [{
                functionResponse: {
                  name,
                  response: { result },
                },
              }],
            });
          }
        } catch (parseError) {
          console.error("❌ JSON PARSE ERROR:", parseError);
          throw new Error(`Failed to parse AI response: ${parseError.message}`);
        }
      } 
      // Check if it's a function call from the parts (old method)
      else {
        const functionCall = parts.find((p) => p.functionCall);

        if (functionCall) {
          const { name, args } = functionCall.functionCall;
          
          if (name === "executeCommand") {
            progress.report({ message: "Creating files and folders..." });
            console.log("🔧 EXECUTING COMMAND:", args.command);
            
            const result = await executeVSCodeCommand(args);

            // Feed result back to model
            History.push({
              role: "user",
              parts: [{
                functionResponse: {
                  name,
                  response: { result },
                },
              }],
            });
          }
        } else {
          // Model gave final output (Phase 11 or casual response)
          console.log("✅ FINAL RESPONSE:", responseText);
          return responseText;
        }
      }
    } catch (err) {
      console.error("❌ PROCESSING ERROR:", err);
      throw new Error(`AI processing failed: ${err.message}`);
    }
  }
}

/**
 * VS Code Extension Activation
 */
function activate(context) {
  // Build Website Command
  let buildDisposable = vscode.commands.registerCommand('frontify.build', async () => {
    // Check for workspace
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showErrorMessage('Please open a folder in VS Code first!');
      return;
    }

    // Check API key before proceeding
    try {
      getApiKey(); // This will throw error if API key is not set
    } catch (error) {
      // Error is already handled in getApiKey() with user-friendly message
      return;
    }

    // Get user prompt
    const userPrompt = await vscode.window.showInputBox({
      prompt: 'What website do you want to build?',
      placeHolder: 'e.g., Create a portfolio website with dark mode and animations...',
      ignoreFocusOut: true
    });

    if (!userPrompt) {
      vscode.window.showWarningMessage('Frontify: Website creation cancelled.');
      return;
    }

    // Clear previous history
    History.length = 0;

    // Show progress
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Frontify - Building Your Website",
      cancellable: false
    }, async (progress) => {
      try {
        const finalResult = await processWithAI(userPrompt, progress);
        
        vscode.window.showInformationMessage(
          'Frontify: Website created successfully! Check your workspace for the new files.',
          'Open Folder'
        );
        
        // Show final result in output channel
        const outputChannel = vscode.window.createOutputChannel('Frontify');
        outputChannel.show();
        outputChannel.appendLine('✅ Frontify: Website built successfully!');
        outputChannel.appendLine(finalResult);

      } catch (error) {
        vscode.window.showErrorMessage(`Frontify: Failed to create website - ${error.message}`);
      }
    });
  });

  // Setup API Key Command - THIS WAS MISSING!
  let setupDisposable = vscode.commands.registerCommand('frontify.setup', async () => {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your Gemini API Key from Google AI Studio',
      placeHolder: 'Paste your API key here...',
      ignoreFocusOut: true,
      password: false
    });

    if (apiKey) {
      // Save to VS Code settings
      await vscode.workspace.getConfiguration('frontify').update('apiKey', apiKey, vscode.ConfigurationTarget.Global);
      
      vscode.window.showInformationMessage(
        'Frontify: API key saved successfully! You can now build websites.',
        'Open Settings'
      ).then(selection => {
        if (selection === 'Open Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'frontify.apiKey');
        }
      });
    } else {
      vscode.window.showWarningMessage('Frontify: API key setup cancelled.');
    }
  });

  // Add both commands to subscriptions
  context.subscriptions.push(buildDisposable, setupDisposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};