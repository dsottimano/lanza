// Self-configuring tenant (design §3.4). These are PUBLIC values, safe to commit,
// and identical for every Lanza site — baked into the template so a generated repo
// needs no manual setup to log in. Env vars of the same name override them
// (BROKER_ORIGIN / HANDOFF_PUBLIC_KEY), which the dogfood + preview sites use.
//
// Per-tenant identity (owner/name/adminLogin) is NOT here — it lives in the repo-root
// lanza.config.json, which the onboarding broker writes per tenant at repo creation.
// Keeping it out of functions/ lets the whole dir ship as pure @lanza/site code.
export const BROKER_ORIGIN = "https://connect.lanzacms.com";

export const HANDOFF_PUBLIC_KEY =
  "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUF0blBYTlBoQVQ5Qk1GQStuZGtEaApEa3VPSytrRmVGQ1d3SVZtaUpzQWZ5blg3Umt1MWdkYmVZKzRsOGI0M0NEcHJMQzVqNEc4aTYvenNNWE1La0kwCkRTNVNGcm9ua3VXS3lmdENUbE1kTzFDWkhMREMyYVkyZHN4c1g4KzJtMjMrOEJYQ0RodkVmV0J3cWlkSm4wcTEKZHRMOG5DdWJLazJBVllQaW80bVpPYldBeUR6YUdBdWQxSTlUcmdxeXRhdk1HMXdObnFMRlV6RUNUTm9ZNXBTWAp5YW5ONEczeDlsQzRnbStieTJnRG1jUXQzMThrYTRBMCticDRzMGhYRmN0UjZNc0d0K1duWHdMQVYzVTFkSysxClRtV1NEd05YRW1qcVFVU291czVpcm5SNjN2Ni82YkNsYlNmQ2ZmdTJvYzVkV2pSZ1ZBSFR6UXpDSWpPMVNyeEoKV3dJREFRQUIKLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==";
