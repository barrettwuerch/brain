// THE BRAIN — Embeddings wrapper (OpenAI)
import 'dotenv/config';
function req(name) {
    const v = process.env[name];
    if (!v)
        throw new Error(`Missing env ${name}`);
    return v;
}
/**
 * Embed a string into a 1536-dimension vector.
 *
 * NOTE: This is a scaffold wrapper. It uses the OpenAI embeddings endpoint via fetch.
 * Swap providers later without changing call sites.
 */
export async function embed(text) {
    const apiKey = req('OPENAI_API_KEY');
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'text-embedding-3-small',
            input: text,
            // dimension is fixed by the model; expected 1536
        }),
    });
    const raw = await resp.text();
    if (!resp.ok)
        throw new Error(`OpenAI embeddings error ${resp.status}: ${raw}`);
    const data = JSON.parse(raw);
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec))
        throw new Error('Embeddings response missing embedding array');
    return vec;
}
