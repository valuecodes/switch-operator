type ParsedCallback =
  | { action: "confirm" | "cancel"; token: string }
  | { action: "answer"; token: string; optionIndex: number };

const parseCallbackData = (
  data: string | undefined
): ParsedCallback | undefined => {
  if (!data) {
    return undefined;
  }
  if (data.startsWith("q:")) {
    const rest = data.slice(2);
    const colon = rest.indexOf(":");
    if (colon === -1) {
      return undefined;
    }
    const token = rest.slice(0, colon);
    const indexStr = rest.slice(colon + 1);
    if (!token || !/^\d+$/.test(indexStr)) {
      return undefined;
    }
    return {
      action: "answer",
      token,
      optionIndex: Number.parseInt(indexStr, 10),
    };
  }
  const colon = data.indexOf(":");
  if (colon === -1) {
    return undefined;
  }
  const prefix = data.slice(0, colon);
  const token = data.slice(colon + 1);
  if (!token) {
    return undefined;
  }
  if (prefix === "c") {
    return { action: "confirm", token };
  }
  if (prefix === "x") {
    return { action: "cancel", token };
  }
  return undefined;
};

export { parseCallbackData };
export type { ParsedCallback };
