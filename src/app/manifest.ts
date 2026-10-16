import type { MetadataRoute } from "next";

// Lets the app be installed to a phone's home screen, and (on Android) appear in the
// share sheet so a link from any app can be sent straight into a new post.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CtrlAltSocials",
    short_name: "CtrlAlt",
    description: "Post and schedule across every project's social accounts.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0d12",
    theme_color: "#0b0d12",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    share_target: {
      action: "/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
  } as MetadataRoute.Manifest;
}
