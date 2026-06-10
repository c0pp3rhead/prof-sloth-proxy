const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- NEW TIER 3: MULTI-MODAL OPENAI FALLBACK ---
async function callOpenAIFallback(prompt, imageBase64) {
    const userContent = [{ type: "text", text: prompt }];

    // If an image payload exists, attach it using OpenAI's vision schema
    if (imageBase64) {
        userContent.push({
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
            }
        });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "You are Atlas the Explorer, a daring adventurer." },
                { role: "user", content: userContent }
            ],
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API Failure: ${errText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// --- TIER 4: TEXT-ONLY DEEPSEEK FAIL-SAFE ---
async function callDeepSeekFallback(prompt, imageBase64) {
    if (imageBase64) {
        throw new Error("DeepSeek active: Vision (image grading) is unsupported by this tier.");
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: "deepseek-chat", 
            messages: [
                { role: "system", content: "You are Atlas the Explorer, a daring adventurer." },
                { role: "user", content: prompt }
            ],
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek API Failure: ${errText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

app.post('/api/gemini', async (req, res) => {
    const { prompt, imageBase64 } = req.body;
    let textResult = "";
    const imagePart = imageBase64 ? { inlineData: { data: imageBase64, mimeType: "image/jpeg" } } : null;

    // TIER 1: Primary Model (Google Gemini 2.5 Flash)
    try {
        const primaryModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = imagePart 
            ? await primaryModel.generateContent([prompt, imagePart])
            : await primaryModel.generateContent(prompt);
        
        textResult = result.response.text();
        return res.json({ text: textResult });

    } catch (primaryError) {
        console.warn("Tier 1 (Gemini 2.5) failed. Attempting Tier 2...", primaryError.message);

        // TIER 2: Secondary Model (Google Gemini 1.5 Flash)
        try {
            const backupModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = imagePart 
                ? await backupModel.generateContent([prompt, imagePart])
                : await backupModel.generateContent(prompt);
            
            textResult = result.response.text();
            return res.json({ text: textResult });

        } catch (secondaryError) {
            console.warn("Tier 2 (Gemini 1.5) failed. Escalating to Cross-Vendor Tier 3 (OpenAI Vision)...", secondaryError.message);

            // TIER 3: Cross-Vendor Redundancy (OpenAI GPT-4o-Mini - Text + Vision)
            try {
                textResult = await callOpenAIFallback(prompt, imageBase64);
                return res.json({ text: textResult });

            } catch (openaiError) {
                console.warn("Tier 3 (OpenAI) failed. Dropping to Tier 4 text emergency fail-safe...", openaiError.message);

                // TIER 4: Absolute Emergency Text Fallback (DeepSeek)
                try {
                    textResult = await callDeepSeekFallback(prompt, imageBase64);
                    return res.json({ text: textResult });

                } catch (vendorError) {
                    console.error("Critical Failure: All AI vendor models are unresponsive.", vendorError.message);
                    return res.status(503).json({ error: "All engine links are down due to severe atmospheric interference." });
                }
            }
        }
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Atlas Server listening on port ${PORT}`);
});