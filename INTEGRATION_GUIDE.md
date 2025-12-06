# JKChat Integration Guide

You want to add this chat as `jaykrishnamandal.com.np/chat.html`.

## Integration Steps

1.  **Copy Files**: Copy the following 4 files from this folder to the **root** folder of your `jaykrishnamandal.github.io` (or website) repository:

    - `chat.html` (This was index.html)
    - `style.css`
    - `script.js`
    - `firebase-config.js`

2.  **Push to GitHub**:

    - Commit and push these files to your main website's repository.

3.  **Access**:
    - Go to: `https://jaykrishnamandal.com.np/chat.html`

## Notes

- **Dependencies**: The app uses CDN links (Firebase, FontAwesome, Picmo), so no `npm install` is needed.
- **Mobile Optimized**: It includes the latest fixes for Android/Redmi keyboards.
- **files relative**: Ensure all 4 files are in the _same_ folder on your server.
