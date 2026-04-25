const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const TELEGRAM_HTML_SAFE_LENGTH = 3500;

const splitMessage = (
  text: string,
  maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH
): string[] => {
  if (text.length <= maxLength) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = maxLength;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
};

export { splitMessage, TELEGRAM_HTML_SAFE_LENGTH, TELEGRAM_MAX_MESSAGE_LENGTH };
