
export async function onRequestPost({ request, env }) {
  try {
    if (!env.GROQ_API_KEY) {
      return Response.json(
        { error: "GROQ_API_KEY is not configured." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const documents = body.documents;

    if (!Array.isArray(documents) || documents.length === 0) {
      return Response.json(
        { error: "Please provide at least one document." },
        { status: 400 }
      );
    }

    // Validate and normalize document text.
    const validDocuments = documents.map((doc, index) => {
      if (
        typeof doc.name !== "string" ||
        typeof doc.text !== "string" ||
        !doc.text.trim()
      ) {
        throw new Error(`Invalid or empty document at position ${index + 1}`);
      }

      return {
        name: doc.name,
        text: doc.text.normalize("NFC").replace(/\r\n?/g, "\n")
      };
    });

    // Detect exact duplicate extracted text.
    const groups = new Map();

    for (const doc of validDocuments) {
      const existing = groups.get(doc.text) || [];
      existing.push(doc.name);
      groups.set(doc.text, existing);
    }

    const duplicateGroups = [];

    for (const [content, files] of groups.entries()) {
      if (files.length > 1) {
        duplicateGroups.push({
          files,
          duplicateCount: files.length,
          matchingCharacters: content.length,
          detectionType: "EXACT_TEXT_MATCH"
        });
      }
    }

    const duplicateDocumentCount = duplicateGroups.reduce(
      (total, group) => total + group.duplicateCount,
      0
    );

    const results = {
      agent_id: "duplicate-detector-01",
      totalDocuments: validDocuments.length,
      duplicateGroups,
      duplicateDocumentCount,
      uniqueDocuments: validDocuments.length - duplicateDocumentCount,
      detectionMethod: "Exact equality of normalized extracted text",
      scanStatus: "COMPLETED",
      scannedAt: new Date().toISOString()
    };

    // Groq generates a readable report from the actual scan results.
    const groqResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content:
  "You are a document duplication reporting assistant. " +
  "Explain only the supplied scan results. Do not invent findings. " +
  "Clearly state whether duplicates were found."
            },
            {
              role: "user",
              content:
                "Create a concise professional document duplication report " +
                "from these scan results:\n" + JSON.stringify(results)
            }
          ],
          temperature: 0.2,
          max_completion_tokens: 1000
        })
      }
    );

    const groqData = await groqResponse.json();

    if (!groqResponse.ok) {
      return Response.json(
        {
          error: "Groq report generation failed.",
          details: groqData
        },
        { status: 502 }
      );
    }

    results.aiReport =
      groqData.choices?.[0]?.message?.content ||
      "Report could not be generated.";

    return Response.json(results);

  } catch (error) {
    return Response.json(
      { error: error.message || "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
