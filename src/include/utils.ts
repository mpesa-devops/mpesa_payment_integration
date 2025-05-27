export function extractAmountFromCallbackMetadata(callbackMetadata: any): number {
    if (!callbackMetadata || !callbackMetadata.Item) return 0;
    const amountItem = callbackMetadata.Item.find((item: any) => item.Name === "Amount");
    return amountItem ? amountItem.Value : 0;
}
