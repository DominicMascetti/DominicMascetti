# Renders ```mermaid fenced code blocks to inline SVG at build time with Pele
# (https://pele.run), via _scripts/pele-render.mjs. No JavaScript ships to
# the page: each block is replaced by <figure class="diagram"><svg>…</svg></figure>.
#
# Without Node or node_modules/pele (e.g. a local `jekyll serve`), blocks are
# left as code with a warning. In CI (CI or GITHUB_ACTIONS set), a missing
# renderer or a diagram that fails to render stops the build.

require "cgi"
require "digest"
require "json"
require "open3"

module PeleDiagrams
  # Matched to assets/css/site.css: body font, monospace font, and the .wrap
  # content width (640px max-width minus 2 × 1.5rem padding = 592px).
  OPTIONS = {
    "fontFamily"     => "'EB Garamond', Georgia, serif",
    "fontFamilyMono" => "'JetBrains Mono', monospace",
    "maxWidth"       => 592,
    "autoDirection"  => true,
    "responsive"     => true,
  }.freeze

  # kramdown + rouge output for ```mermaid, plus the bare form kramdown
  # produces when syntax highlighting is off.
  BLOCK = %r{
    <div\ class="language-mermaid[^"]*">\s*<div\ class="highlight">\s*
      <pre\ class="highlight">\s*<code[^>]*>(?<code>.*?)</code>\s*</pre>\s*
    </div>\s*</div>
    |
    <pre[^>]*>\s*<code\ class="language-mermaid[^"]*"[^>]*>(?<code>.*?)</code>\s*</pre>
  }mx

  class << self
    def ci?
      !ENV["CI"].to_s.empty? || !ENV["GITHUB_ACTIONS"].to_s.empty?
    end

    def cache
      @cache ||= Jekyll::Cache.new("PeleDiagrams")
    end

    def pele_version(site)
      return @pele_version if defined?(@pele_version)

      manifest = File.join(site.source, "node_modules", "pele", "package.json")
      @pele_version = File.exist?(manifest) ? JSON.parse(File.read(manifest))["version"] : nil
    end

    def process(doc)
      return unless doc.output&.include?("language-mermaid")

      matches = []
      doc.output.scan(BLOCK) { matches << Regexp.last_match[:code] }
      return if matches.empty?

      site = doc.site
      path = doc.relative_path
      version = pele_version(site)
      unless version
        unavailable(path, "node_modules/pele not found (run `npm install`)")
        return
      end

      seen = Hash.new(0)
      items = matches.map do |code|
        source = CGI.unescapeHTML(code.gsub(/<[^>]+>/, "")).strip
        digest = Digest::SHA256.hexdigest(source)[0, 10]
        # Unique per diagram so ids never collide on a page; stable across
        # builds so the cache stays warm.
        n = (seen[digest] += 1)
        prefix = n == 1 ? "pele-#{digest}" : "pele-#{digest}-#{n}"
        key = Digest::SHA256.hexdigest(JSON.generate([source, version, OPTIONS, prefix]))
        { "source" => source, "idPrefix" => prefix, "key" => key }
      end

      misses = items.reject { |item| cache.key?(item["key"]) }
      unless misses.empty?
        results = render(site, misses, path) or return
        misses.zip(results).each do |item, result|
          if result["svg"]
            cache[item["key"]] = result["svg"]
          else
            failed(path, result["error"], item["source"])
          end
        end
      end

      i = -1
      doc.output = doc.output.gsub(BLOCK) do
        item = items[i += 1]
        cache.key?(item["key"]) ? %(<figure class="diagram">#{cache[item["key"]]}</figure>) : $&
      end
    end

    private

    def render(site, items, path)
      script = File.join(site.source, "_scripts", "pele-render.mjs")
      payload = JSON.generate(items.map { |item| item.slice("source", "idPrefix") })
      out, err, status = Open3.capture3("node", script, JSON.generate(OPTIONS), stdin_data: payload)
      unless status.success?
        unavailable(path, "node exited with #{status.exitstatus}: #{err.strip}")
        return nil
      end
      JSON.parse(out)
    rescue Errno::ENOENT
      unavailable(path, "node is not installed")
      nil
    end

    def unavailable(path, reason)
      message = "Mermaid diagrams in #{path} not rendered: #{reason}"
      raise Jekyll::Errors::FatalException, message if ci?

      Jekyll.logger.warn "Pele:", "#{message}. Leaving them as code blocks."
    end

    def failed(path, error, source)
      message = "Mermaid diagram in #{path} failed to render: #{error}\n#{source}"
      raise Jekyll::Errors::FatalException, message if ci?

      Jekyll.logger.warn "Pele:", "#{message}\nLeaving it as a code block."
    end
  end
end

Jekyll::Hooks.register [:pages, :documents], :post_render do |doc|
  PeleDiagrams.process(doc)
end
