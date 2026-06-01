const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
// Set high limit because images sent from the app are large Base64 strings
app.use(express.json({ limit: '20mb' })); 

// This pulls your secure key from Render's environment vault
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, imageBase64 } = req.body;
        
        // Use the system instruction trick for Atlas's persona
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        let result;
        if (imageBase64) {
            // Grading an image
            const imagePart = { inlineData: { data: imageBase64, mimeType: "image/jpeg" } };
            result = await model.generateContent([prompt, imagePart]);
        } else {
            // Just generating a problem
            result = await model.generateContent(prompt);
        }

        res.json({ text: result.response.text() });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Atlas Server listening on port ${PORT}`);
});