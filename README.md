# Vue 3 + Vite

```
npx create-vite@latest .
```

# build
```
sudo npm install -g pnpm
pnpm i
npm run build
```

# index.html
```
response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
response.setHeader("Pragma", "no-cache");
response.setDateHeader("Expires", 0);

w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0")
w.Header().Set("Pragma", "no-cache")
w.Header().Set("Expires", time.Unix(0, 0).Format(http.TimeFormat))
```