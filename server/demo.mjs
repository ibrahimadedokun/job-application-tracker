// Intentionally not AI: a transparent local preview that never claims generated facts.
export async function demoGenerate(job, source) {
  const words = [
    ...new Set(
      job.description.toLowerCase().match(/\b[a-z][a-z-]{5,}\b/g) || [],
    ),
  ].filter(
    (w) =>
      ![
        "looking",
        "experience",
        "through",
        "across",
        "everyone",
        "create",
        "design",
        "product",
        "working",
        "senior",
        "engineers",
      ].includes(w),
  );
  const gaps = words
    .filter((w) => !source.cv.toLowerCase().includes(w))
    .slice(0, 8);
  return {
    cv: `${source.cv}\n\nTARGET ROLE\n${job.role} at ${job.company}\n\nDEMO PREVIEW — original facts retained. Review and edit before use.`,
    coverLetter: source.coverLetter
      ? `${source.coverLetter}\n\nI would welcome the opportunity to discuss how my experience could contribute to ${job.company} as ${job.role}.\n\nDEMO PREVIEW — please review before sending.`
      : `Dear hiring team at ${job.company},\n\nI am applying for the ${job.role} position. I would welcome the opportunity to discuss my background and how it aligns with your team’s needs.\n\n[Add a specific example from your CV that demonstrates a requirement in the job description.]\n\nThank you for your consideration.\n\nKind regards,\n[Your name]\n\nDEMO PREVIEW — a template, not AI-generated tailoring.`,
    changes: [
      "Local demo: kept the original CV intact and added the target role.",
      "Added a template closing or cover letter; replace placeholders and review before use.",
      "Real context-aware rewriting requires an enabled AWS Bedrock model.",
    ],
    missingKeywords: gaps,
  };
}
