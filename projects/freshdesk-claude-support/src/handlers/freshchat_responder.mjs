export async function respondToChat({ freshchat, conversationId, aiResult, botAgentId, escalationAgentId } = {}) {
  const { customer_response, agent_report, escalate } = aiResult;
  void agent_report; // Freshchat doesn't support private notes in the same way.

  if (!customer_response) return;
  if (!freshchat) throw new Error('Freshchat client not configured');
  if (!botAgentId) throw new Error('Missing FRESHCHAT_BOT_AGENT_ID');

  await freshchat.sendMessage({ conversationId, actorId: botAgentId, text: customer_response });

  if (escalate && escalationAgentId) {
    await freshchat.assignConversation({ conversationId, agentId: escalationAgentId });
  }
}
