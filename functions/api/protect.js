
export async function onRequestPost({ request, env }) {
  try {
    // Verify required Guardian configuration.
    if (!env.GUARDIAN_API_KEY) {
      return Response.json(
        { error: "Guardian API key is not configured." },
        { status: 500 }
      );
    }

    const body = await request.json();

    const allowedActions = [
      "delete_document",
      "overwrite_document",
      "delete_folder"
    ];

    if (!allowedActions.includes(body.action)) {
      return Response.json(
        { error: "Unsupported protected action." },
        { status: 400 }
      );
    }

    // Always use the registered agent identity.
    const guardianPayload = {
      agent_id: "duplicate-detector-01",
      action: body.action,
      parameters: {
        file_name: body.file_name || "test-document.txt",
        operation: body.action,
        reason: body.reason || "ContentGuard protected action request"
      }
    };

    // Ask Guardian before allowing any protected operation.
    const guardianResponse = await fetch(
      "https://agents-guardian.ai.studio/api/v1/intercept",
      {
        method: "POST",
        headers: {
          "X-Guardian-Key": env.GUARDIAN_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(guardianPayload),
        signal: AbortSignal.timeout(15000)
      }
    );

    const responseText = await guardianResponse.text();

    let guardianResult;

    try {
      guardianResult = JSON.parse(responseText);
    } catch {
      return Response.json(
        { error: "Guardian returned an invalid response. Action stopped." },
        { status: 502 }
      );
    }

    if (!guardianResponse.ok) {
      return Response.json(
        {
          error: "Guardian request failed. Action stopped.",
          guardianStatus: guardianResponse.status
        },
        { status: 502 }
      );
    }

    const decision = String(
      guardianResult.decision || ""
    ).toUpperCase();

    const status = String(
      guardianResult.status || ""
    ).toUpperCase();

    // Fail closed: only an explicit authorization can pass.
    const authorized =
      guardianResult.authorized === true &&
      status !== "HALTED" &&
      ["ALLOW", "ALLOWED", "APPROVED"].includes(decision);

    if (!authorized) {
      return Response.json(
        {
          agent_id: "duplicate-detector-01",
          action: body.action,
          authorized: false,
          status: status || "BLOCKED",
          decision: decision || "UNKNOWN",
          message: "Guardian did not explicitly authorize this action. Execution stopped.",
          guardianResponse: guardianResult
        },
        { status: 403 }
      );
    }

    // Test mode: do not actually delete or overwrite any file.
    return Response.json({
      agent_id: "duplicate-detector-01",
      authorized: true,
      decision,
      status,
      message: "Guardian authorized the request. Test mode: no file was modified.",
      executionMode: "SIMULATION_ONLY"
    });

  } catch (error) {
    // Any unexpected error stops the protected action.
    return Response.json(
      {
        error: "Protected action stopped.",
        details: error.message
      },
      { status: 503 }
    );
  }
}
