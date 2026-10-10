import { afterEach, describe, it, expect, vi } from "vitest";
import { GitHubClient } from "./github";
import { fileSlug, uploadableExt, uploadImage } from "./media";

// An upload is committed to the repo and served as a static asset from the SITE's
// origin — the same origin as /admin. Cloudflare picks the Content-Type from the
// extension, so an .html or .svg upload is a scripted document on the origin that
// carries the session cookie. Each refusal below asserts BOTH the throw and that
// nothing reached GitHub (uploadBinary never called).

function fakeClient() {
  const uploadBinary = vi.fn(async (_path: string, _base64: string, _message: string, _sha?: string) => undefined);
  const currentSha = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined);
  return { client: { uploadBinary, currentSha } as unknown as GitHubClient, uploadBinary, currentSha };
}

const file = (name: string, type = "image/png") =>
  new File([new Uint8Array([1, 2, 3])], name, { type });

describe("media upload extension allowlist", () => {
  it("accepts the raster formats the site can actually publish", () => {
    for (const ext of ["png", "jpg", "jpeg", "gif", "webp", "avif"]) {
      expect(uploadableExt(`photo.${ext}`), ext).toBe(ext);
      expect(uploadableExt(`Photo.${ext.toUpperCase()}`), ext).toBe(ext);
    }
  });

  it("rejects scriptable and unknown types — SVG included", () => {
    for (const name of ["evil.svg", "evil.html", "evil.htm", "evil.xhtml", "evil.js", "evil.pdf", "noextension"]) {
      expect(uploadableExt(name), name).toBeNull();
    }
  });

  it("a double extension is judged by the one that will be SERVED", () => {
    expect(uploadableExt("evil.html.png")).toBe("png"); // served as an image
    expect(uploadableExt("evil.png.html")).toBeNull(); // served as a document
  });

  it("refuses the upload and commits nothing", async () => {
    for (const name of ["evil.svg", "evil.html", "payload"]) {
      const { client, uploadBinary } = fakeClient();
      await expect(uploadImage(client, file(name, "image/svg+xml"))).rejects.toThrow(
        /isn't an image type Lanza will publish/,
      );
      expect(uploadBinary, name).not.toHaveBeenCalled();
    }
  });

  it("a real image still uploads and returns its public path", async () => {
    const { client, uploadBinary } = fakeClient();
    const url = await uploadImage(client, file("My Photo!!.PNG"));
    expect(url).toBe("/images/uploads/my-photo.png");
    expect(uploadBinary).toHaveBeenCalledOnce();
    expect(uploadBinary.mock.calls[0][0]).toBe("public/images/uploads/my-photo.png");
  });

  it("fileSlug keeps the allowed extension it was given", () => {
    expect(fileSlug("My Photo!!.jpg")).toBe("my-photo.jpg");
  });
});

afterEach(()=>vi.unstubAllGlobals());
it('pins confirmed replacements to the version found before confirmation',async()=>{
 const f=fakeClient();f.currentSha.mockResolvedValue('confirmed');vi.stubGlobal('confirm',vi.fn().mockReturnValue(true));
 await uploadImage(f.client,file('photo.png'));expect(f.uploadBinary.mock.calls[0]![3]).toBe('confirmed');expect(f.currentSha).toHaveBeenCalledTimes(1);
});
it('declining replacement finds a free name and creates without a SHA',async()=>{
 const f=fakeClient();f.currentSha.mockResolvedValueOnce('existing').mockResolvedValueOnce('also-existing').mockResolvedValueOnce(undefined);vi.stubGlobal('confirm',vi.fn().mockReturnValue(false));
 expect(await uploadImage(f.client,file('photo.png'))).toBe('/images/uploads/photo-3.png');expect(f.uploadBinary.mock.calls[0]![3]).toBeUndefined();
});
it.each([409,422])('does not turn an upload conflict %s into an overwrite',async status=>{
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({message:'Conflict'}),{status}));vi.stubGlobal('fetch',fetch);
 await expect(new GitHubClient().uploadBinary('public/images/uploads/photo.png','AQID','upload')).rejects.toThrow();
 expect(fetch).toHaveBeenCalledTimes(1);const body=JSON.parse(fetch.mock.calls[0]![1].body);expect(body.sha).toBeUndefined();
});
it('passes an explicit replacement SHA through to the single write',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({content:{sha:'next'}}),{status:200}));vi.stubGlobal('fetch',fetch);
 await new GitHubClient().uploadBinary('public/images/uploads/photo.png','AQID','upload','confirmed');
 expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(fetch.mock.calls[0]![1].body).sha).toBe('confirmed');
});
