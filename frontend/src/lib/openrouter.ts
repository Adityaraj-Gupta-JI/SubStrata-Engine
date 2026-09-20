// src/lib/openrouter.ts

export async function sendAgentMessage(
  message: string,
  tenantId: string,
  apiKey: string,
  model: string = "mistralai/mistral-small-24b-instruct-2501:free"
) {
  const systemPrompt = `You are SubStrata-01 EAV Engine operating for tenant [${tenantId}].
  Analyze the user request and provide:
  1. A structured EAV breakdown.
  2. JSON mutation instructions or standard SQL code block for EAV tables.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "SubStrata Engine"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message }
      ]
    })
  });

  return await response.json();
}