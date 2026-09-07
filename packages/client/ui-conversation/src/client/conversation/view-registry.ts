import type { ConversationViewDefinition } from '../contract/conversation.ts'
import { ConversationDefinitionRegistry } from './definition-registry.ts'

/** Runtime registry of Conversation target builders and presentation-only capabilities. */
export class ConversationViewRegistry extends ConversationDefinitionRegistry<ConversationViewDefinition> {

  /**
   * Register a uniquely named target capability for the caller's lifetime.
   * @param definition - target builder or presentation-only contribution.
   * @returns idempotent disposer.
   */
  register(definition: ConversationViewDefinition): () => void {
    return this.registerDefinition(
      definition.target,
      definition,
      `conversation view target "${definition.target}" is already registered`,
      `uiConversation.views.register(${JSON.stringify(definition.target)})`,
    )
  }
}
