
export async function onRequestPost({ request, env }) {
  try {
    // 1. Check that the Groq API key is configured
    if (!env.GROQ_API_KEY) {
      return jsonResponse({
        success: false,
        error: "Groq API key is not configured on the server."
      }, 500);
    }

    // 2. Read uploaded document text
    const body = await request.json();

    if (!Array.isArray(body.documents) || body.documents.length === 0) {
      return jsonResponse({
        success: false,
        error: "Please provide at least one document."
      }, 400);
    }

    if (body.documents.length > 10) {
      return jsonResponse({
        success: false,
        error: "Maximum 10 documents per scan."
      }, 400);
    }

    // 3. Validate and normalize document text
    const documents = body.documents.map((doc, index) => {
      if (
        typeof doc.name !== "string" ||
        typeof doc.text !== "string" ||
        !doc.text.trim()
      ) {
        throw new Error(
          `Document ${index + 1} has a missing name or empty text.`
        );
      }

      const normalizedText = doc.text
        .normalize("NFC")
        .replace(/\r\n?/g, "\n");

      return {
        name: doc.name.slice(0, 200),
        text: normalizedText
      };
    });

    // 4. Compare documents for exact text duplicates
    const groups = new Map();

    for (const doc of documents) {
      if (!groups.has(doc.text)) {
        groups.set(doc.text, []);
      }

      groups.get(doc.text).push(doc.name);
    }

    const duplicateGroups = [];

    for (const [text, files] of groups.entries()) {
      if (files.length > 1) {
        duplicateGroups.push({
          files,
          duplicateCount: files.length,
          matchingCharacters: text.length,
          detectionType: "EXACT_TEXT_MATCH"
        });
      }
    }

    const duplicateDocumentCount = duplicateGroups.reduce(
      (total, group) => total + group.duplicateCount,
      0
    );

    const uniqueDocuments =
      documents.length - duplicateDocumentCount;

    // 5. Prepare scan results for the AI report
    // Document contents are NOT sent to Groq.
    const scanSummary = {
      totalDocuments: documents.length,
      uniqueDocuments,
      duplicateDocumentCount,
      duplicateGroups,
      detectionMethod:
        "Exact equality after Unicode NFC and line-ending normalization"
    };

    // 6. Ask Groq to prepare a human-readable report
    let aiReport = "AI report could not be generated.";
    let aiReportStatus = "UNAVAILABLE";

    try {
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: env.GROQ_MODEL || "openai/gpt-oss-20b",
            messages: [
              {
                role: "system",
                content:
                  "You are ContentGuard, a document duplication reporting assistant. " +
                  "Use only the supplied scan results. Never invent findings. " +
                  "Explain the number of documents scanned, unique documents, " +
                  "duplicate groups, and recommended next steps. " +
                  "Do not recommend deleting or overwriting documents."
              },
              {
                role: "user",
                content:
                  "Prepare a concise professional document duplication report " +
                  "from these results:\n" +
                  JSON.stringify(scanSummary)
              }
            ],
            temperature: 0.2,
            max_completion_tokens: 800
          })
        }
      );

      if (groqResponse.ok) {
        const groqData = await groqResponse.json();

        aiReport =
          groqData.choices?.[0]?.message?.content ||
          "The AI returned an empty report.";

        aiReportStatus = "COMPLETED";
      } else {
        console.error(
          "Groq API error:",
          groqResponse.status
        );
      }
    } catch (aiError) {
      console.error("Groq request failed:", aiError);
    }

    // 7. Return results to the website
    return jsonResponse({
      success: true,
      agentId: "duplicate-detector-01",
      scanStatus: "COMPLETED",
      scannedAt: new Date().toISOString(),
      ...scanSummary,
      aiReport,
      aiReportStatus
    }, 200);

  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message || "An unexpected scanning error occurred."
    }, 400);
  }
}

// Standard JSON response helper
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
