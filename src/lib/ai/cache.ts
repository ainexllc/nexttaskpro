import { createHash } from 'crypto'
import { AICacheEntry, AIModel } from './types'

// In-memory cache for AI responses (in production, use Redis)
class AICache {
  private cache = new Map<string, AICacheEntry>()
  private cleanupInterval: NodeJS.Timeout

  constructor() {
    // Clean expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  /**
   * Generate cache key from request parameters
   */
  private generateKey(
    prompt: string,
    model: AIModel,
    systemPrompt?: string,
    maxTokens?: number
  ): string {
    const input = JSON.stringify({
      prompt: prompt.trim().toLowerCase(),
      model,
      systemPrompt,
      maxTokens,
    })
    return createHash('sha256').update(input).digest('hex')
  }

  /**
   * Get cached response if available and not expired
   */
  get(
    prompt: string,
    model: AIModel,
    systemPrompt?: string,
    maxTokens?: number
  ): AICacheEntry | null {
    const key = this.generateKey(prompt, model, systemPrompt, maxTokens)
    const entry = this.cache.get(key)

    if (!entry) {
      return null
    }

    // Check if expired
    if (entry.expiresAt < new Date()) {
      this.cache.delete(key)
      return null
    }

    // Increment hit count
    entry.hitCount++
    return entry
  }

  /**
   * Store response in cache
   */
  set(
    prompt: string,
    model: AIModel,
    response: string,
    cost: number,
    cacheDurationMinutes: number = 60,
    systemPrompt?: string,
    maxTokens?: number
  ): void {
    const key = this.generateKey(prompt, model, systemPrompt, maxTokens)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + cacheDurationMinutes * 60 * 1000)

    const entry: AICacheEntry = {
      key,
      response,
      model,
      cost,
      timestamp: now,
      expiresAt,
      hitCount: 0,
    }

    this.cache.set(key, entry)
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = new Date()
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const now = new Date()
    let validEntries = 0
    let expiredEntries = 0
    let totalHits = 0
    let totalCostSaved = 0

    for (const entry of this.cache.values()) {
      if (entry.expiresAt >= now) {
        validEntries++
        totalHits += entry.hitCount
        totalCostSaved += entry.cost * entry.hitCount
      } else {
        expiredEntries++
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries,
      expiredEntries,
      totalHits,
      totalCostSaved,
      hitRate: totalHits / Math.max(validEntries, 1),
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Clear cache for specific model
   */
  clearModel(model: AIModel): void {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.model === model) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get cache size in MB (approximate)
   */
  getSizeInMB(): number {
    let totalSize = 0
    for (const entry of this.cache.values()) {
      totalSize += JSON.stringify(entry).length
    }
    return totalSize / (1024 * 1024)
  }

  /**
   * Clean up intervals on destroy
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.cache.clear()
  }
}

// Template cache for common prompts
class TemplateCache {
  private templates = new Map<string, string>()

  constructor() {
    this.initializeCommonTemplates()
  }

  private initializeCommonTemplates(): void {
    // Task creation templates
    this.templates.set('create_simple_task', 'Create a task: {input}. Format: Title only, no description needed.')
    this.templates.set('prioritize_tasks', 'Rank these tasks by priority (high/medium/low): {input}')
    this.templates.set('suggest_due_date', 'Suggest a realistic due date for: {input}')
    this.templates.set('break_down_task', 'Break down this complex task into subtasks: {input}')
    this.templates.set('estimate_duration', 'Estimate how long this task might take: {input}')
  }

  get(templateName: string, input: string): string | null {
    const template = this.templates.get(templateName)
    if (!template) return null
    
    return template.replace('{input}', input)
  }

  add(name: string, template: string): void {
    this.templates.set(name, template)
  }

  list(): string[] {
    return Array.from(this.templates.keys())
  }
}

// Singleton instances
export const aiCache = new AICache()
export const templateCache = new TemplateCache()

// Utility functions
export function shouldCache(featureType: string, taskType: string): boolean {
  // Only cache task-related operations
  if (featureType !== 'tasks' && featureType !== 'general') {
    return false
  }

  // Cache common task operations
  const cacheableTypes = [
    'create_task',
    'prioritize',
    'suggest',
    'break_down',
    'estimate'
  ]

  return cacheableTypes.some(type => taskType.includes(type))
}

export function getCacheDuration(featureType: string): number {
  const durations: Record<string, number> = {
    tasks: 60,      // 1 hour
    general: 30,    // 30 minutes
  }

  return durations[featureType] ?? 30
}