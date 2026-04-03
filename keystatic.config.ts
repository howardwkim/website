import { config, collection, fields } from "@keystatic/core";

export default config({
  storage: {
    kind: "local",
  },
  collections: {
    posts: collection({
      label: "Blog Posts",
      slugField: "title",
      path: "content/*",
      columns: ["title", "publishedAt"],
      format: {
        contentField: "content",
      },
      schema: {
        title: fields.slug({
          name: { label: "Title" },
        }),
        publishedAt: fields.date({
          label: "Published Date",
          validation: { isRequired: true },
        }),
        updatedAt: fields.date({
          label: "Updated Date",
        }),
        author: fields.text({
          label: "Author",
        }),
        summary: fields.text({
          label: "Summary",
          multiline: true,
          validation: { isRequired: true },
        }),
        image: fields.text({
          label: "Cover Image URL",
        }),
        content: fields.mdx({
          label: "Content",
        }),
      },
    }),
  },
});
