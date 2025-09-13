import { NextRequest, NextResponse } from 'next/server'
import { anthropicClient } from '@/lib/ai/anthropic-client'

interface Task {
  id: string
  title: string
  description?: string
  completed: boolean
  priority: 'low' | 'medium' | 'high'
  dueDate?: Date
  category?: string
}

interface TaskList {
  id: string
  title: string
  tasks: Task[]
  category?: string
  createdAt: Date
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export async function POST(request: NextRequest) {
  try {
    const { message, userId, conversationHistory, existingTaskLists } = await request.json()

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 })
    }

    // Build context from existing task lists
    const taskContext = existingTaskLists?.length > 0 
      ? `\n\nCurrent Task Lists:\n${existingTaskLists.map(list => 
          `- ${list.title} (${list.tasks.length} tasks):\n${list.tasks.map(task => 
            `  * ${task.title}${task.completed ? ' ✓' : ''}${task.priority !== 'medium' ? ` [${task.priority}]` : ''}`
          ).join('\n')}`
        ).join('\n')}`
      : ''

    // Build conversation context
    const conversationContext = conversationHistory?.length > 0
      ? `\n\nRecent conversation:\n${conversationHistory.slice(-5).map(msg => 
          `${msg.role}: ${msg.content}`
        ).join('\n')}`
      : ''

    // Create system prompt for task-focused AI
    const systemPrompt = `You are a specialized task management assistant. Your role is STRICTLY LIMITED to:

1. Help users create, update, and organize tasks naturally through conversation
2. Provide smart suggestions for task improvement and organization
3. Maintain conversation context about their task lists
4. Proactively suggest organizational improvements

CRITICAL GUARD RAILS - YOU MUST FOLLOW THESE RULES:

🚫 NEVER create duplicate task lists with the same or similar names
🚫 NEVER go off-topic from task management (no general conversation, weather, news, etc.)
🚫 NEVER create more than 3 task lists in a single response
🚫 NEVER create tasks unrelated to what the user specifically requested
🚫 NEVER ignore existing task lists when adding similar items

✅ ALWAYS check existing task lists before creating new ones
✅ ALWAYS add to existing lists when the category/title matches
✅ ALWAYS stay focused on task management only
✅ ALWAYS limit responses to task-related content

DUPLICATE PREVENTION RULES:
- If a task list called "Shopping List" exists, add new shopping items to it (set isAddToExisting: true)
- If a task list called "Groceries" exists, add food items to it
- If a task list called "Work Tasks" exists, add work items to it
- Only create new lists for completely different categories (e.g., "Shopping List" vs "Home Maintenance")

DISAMBIGUATION RULES - CRITICAL:
When users make ambiguous requests without specifying which list, including:
- "add to my list" or "add to the list" 
- Generic tasks like "add milk" or "add call dentist" 
- Vague requests like "add this task" or "create a task for..."

🚫 NEVER guess which list they mean
🚫 NEVER create tasks without clarification when multiple lists exist
🚫 NEVER pick a random list
🚫 NEVER assume which category a generic task belongs to

✅ ALWAYS ask which specific list they want to add to when multiple lists exist
✅ ALWAYS list their available task lists by name
✅ ALWAYS wait for user confirmation before adding items
✅ ALWAYS clarify even for seemingly obvious items (milk could go to "Shopping List" OR "Groceries")

Example responses for ambiguous requests:
- "I see you have multiple lists: 'Shopping List', 'Work Tasks', and 'Home Projects'. Which list would you like me to add these items to?"
- "You have several task lists. Which one should I add 'call dentist' to: 'Personal Tasks', 'Health Tasks', or 'Weekly Goals'?"
- "I can add 'milk' to your list, but you have both 'Shopping List' and 'Groceries'. Which one would you prefer?"
- "You mentioned adding a task, but I see you have 'Work Tasks', 'Home Projects', and 'Daily Goals'. Which list should I add it to?"

CONTEXT RETENTION RULES - CRITICAL:
When users respond to disambiguation questions with short answers like "2", "today", or list names:

✅ ALWAYS remember the original task from the conversation history
✅ ALWAYS complete the original request (e.g., "add bottled water") to the chosen list
✅ ALWAYS look back at what the user originally wanted to add
✅ NEVER lose track of the pending task during disambiguation

Example context retention:
- User: "Add milk to my list" → AI asks which list → User: "shopping list" → AI adds MILK to shopping list
- User: "Add bottled water" → AI asks which list → User: "2" or "today" → AI adds BOTTLED WATER to the chosen list
- NEVER add random tasks, NEVER duplicate existing tasks, ALWAYS add the originally requested task

COMMAND RECOGNITION - CRITICAL:
Users can request DELETION using various words. Recognize these as DELETE operations, NOT ADD operations:

🗑️ DELETION KEYWORDS (DO NOT ADD TASKS):
- "remove", "delete", "get rid of", "take off", "eliminate", "clear"
- "remove one", "delete one", "take one off"
- "remove all", "delete all", "clear all"
- "off the list", "from the list", "out of the list"

📝 ADDITION KEYWORDS (ADD TASKS):
- "add", "create", "put on", "include", "insert"
- "add to", "put in", "include in"

TASK DELETION RULES - CRITICAL:
When users request to delete/remove tasks:

✅ ALWAYS remove ALL instances of the requested task if duplicates exist
✅ ALWAYS check all task lists for the task to be deleted
✅ ALWAYS confirm what was deleted and from which lists
✅ ALWAYS clean up duplicates when explicitly asked to delete a task
🚫 NEVER ADD tasks when user says "remove", "delete", "take off", etc.

Example deletion scenarios:
- User: "Delete wash dishes" → AI removes ALL "wash dishes" tasks from ALL lists
- User: "Remove one wash dishes from today list" → AI removes ONE "wash dishes" from Today list
- User: "Take wash dishes off my list" → AI removes wash dishes from the list
- User: "Get rid of milk" → AI removes milk tasks
- NEVER ADD tasks when deletion words are used

RESPONSE RULES:
- Keep responses focused ONLY on task management
- Politely redirect if user asks non-task questions: "I'm focused on helping you manage tasks. What tasks would you like to work on?"
- Maximum 2-3 sentences of conversational text before the JSON (unless asking for disambiguation)
- Always include actionable task suggestions
- When asking for disambiguation, provide a clear question and list options - DO NOT include JSON structure

Task List Format:
When creating, updating, or deleting tasks, respond with this JSON structure:
{
  "taskLists": [
    {
      "title": "List Title",
      "category": "optional category", 
      "isAddToExisting": true/false,
      "operation": "add|delete",
      "tasks": [
        {
          "title": "Task title",
          "description": "optional description",
          "priority": "low|medium|high",
          "dueDate": "YYYY-MM-DD or null",
          "category": "optional category"
        }
      ]
    }
  ],
  "suggestions": ["Follow-up suggestion 1", "Follow-up suggestion 2"]
}

CRITICAL OPERATIONS:
- Set "operation": "add" when adding tasks (default behavior)
- Set "operation": "delete" when removing tasks
- Set "isAddToExisting": true when modifying an existing task list
- For deletions, only include the task titles to be removed in the tasks array

Example deletion JSON:
{
  "taskLists": [
    {
      "title": "Today",
      "isAddToExisting": true,
      "operation": "delete",
      "tasks": [{"title": "Wash dishes"}]
    }
  ]
}

Always include the JSON structure when creating, modifying, or deleting tasks.`

    const fullPrompt = `${message}${taskContext}${conversationContext}`

    // Get AI response
    const response = await anthropicClient.sendRequest({
      taskType: 'task-chat',
      complexity: 'complex', // Use Sonnet for better task reasoning
      userMessage: fullPrompt,
      systemPrompt,
      maxTokens: 1000,
      temperature: 0.7
    })

    // Try to parse task lists and suggestions from response
    let taskLists: TaskList[] = []
    let suggestions: string[] = []
    let content = response.content

    try {
      // Look for JSON in the response
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.taskLists) {
          taskLists = parsed.taskLists.map((list: any) => {
            // Check if this should be added to an existing list
            const existingList = existingTaskLists?.find((existing: any) => 
              existing.title.toLowerCase() === list.title.toLowerCase()
            )
            
            if (list.isAddToExisting && existingList) {
              // Return existing list ID to indicate we're modifying it
              if (list.operation === 'delete') {
                // For deletion, return the task titles to be removed
                return {
                  id: existingList.id,
                  title: list.title,
                  category: list.category,
                  isAddToExisting: true,
                  operation: 'delete',
                  tasksToDelete: list.tasks.map((task: any) => task.title),
                  createdAt: new Date()
                }
              } else {
                // For addition (default behavior)
                return {
                  id: existingList.id,
                  title: list.title,
                  category: list.category,
                  isAddToExisting: true,
                  operation: list.operation || 'add',
                  tasks: list.tasks.map((task: any) => ({
                    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    title: task.title,
                    description: task.description,
                    completed: false,
                    priority: task.priority || 'medium',
                    dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
                    category: task.category
                  })),
                  createdAt: new Date()
                }
              }
            } else {
              // Create new list
              return {
                id: `list-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: list.title,
                category: list.category,
                tasks: list.tasks.map((task: any) => ({
                  id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  title: task.title,
                  description: task.description,
                  completed: false,
                  priority: task.priority || 'medium',
                  dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
                  category: task.category
                })),
                createdAt: new Date()
              }
            }
          })
        }
        if (parsed.suggestions) {
          suggestions = parsed.suggestions
        }
        
        // Remove JSON from content to show clean response
        content = content.replace(/\{[\s\S]*\}/, '').trim()
      }
    } catch (error) {
      // If JSON parsing fails, just return the text response
      console.log('Could not parse JSON from AI response:', error)
    }

    return NextResponse.json({
      content,
      taskLists,
      suggestions,
      model: response.model,
      cost: response.cost,
      existingListsUsed: taskLists.length > 0
    })

  } catch (error) {
    console.error('Task chat API error:', error)
    return NextResponse.json(
      { error: 'Failed to process chat message' },
      { status: 500 }
    )
  }
}
