export async function loadFixture(name: string): Promise<string[]> {
  const text = await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text();
  return text.split("\n").filter((l) => l.trim().length > 0);
}
