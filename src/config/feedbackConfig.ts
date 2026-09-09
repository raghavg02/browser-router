/**
 * Discord Webhook Configuration for Search Router
 * 
 * Paste your Discord Webhook URLs here once you have created the channels in your server:
 * - #🚨-complaints-and-bugs
 * - #✨-feature-requests
 * - #💬-general-feedback
 * - #🧩-other
 * 
 * Note: If you only have one webhook URL, you can paste it into 'fallback' and all
 * categories will be routed to that single webhook.
 */
export const DISCORD_WEBHOOK_CONFIG = {
  bugs: "", // Webhook for #🚨-complaints-and-bugs
  features: "", // Webhook for #✨-feature-requests
  general: "", // Webhook for #💬-general-feedback
  other: "", // Webhook for #🧩-other
  fallback: "", // Fallback webhook if specific category URL is empty
};

export function getWebhookUrlForCategory(category: string): string | undefined {
  switch (category) {
    case "bug":
      return DISCORD_WEBHOOK_CONFIG.bugs || DISCORD_WEBHOOK_CONFIG.fallback || undefined;
    case "feature":
      return DISCORD_WEBHOOK_CONFIG.features || DISCORD_WEBHOOK_CONFIG.fallback || undefined;
    case "general":
      return DISCORD_WEBHOOK_CONFIG.general || DISCORD_WEBHOOK_CONFIG.fallback || undefined;
    case "other":
      return DISCORD_WEBHOOK_CONFIG.other || DISCORD_WEBHOOK_CONFIG.fallback || undefined;
    default:
      return DISCORD_WEBHOOK_CONFIG.fallback || undefined;
  }
}
