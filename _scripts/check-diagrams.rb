# CI check on the built draft: every mermaid block became inline SVG, with no
# scripts, no leftover code blocks, no external renderers, and no duplicate ids.
page = ARGV.fetch(0)
html = File.read(page)
figures = html.scan(%r{<figure class="diagram">.*?</figure>}m)

puts "#{page}: #{figures.size} diagram figure(s)"
figures.each_with_index do |fig, i|
  puts "  #{i + 1}: #{fig.size} chars  #{fig[/<svg[^>]*>/]}"
end

problems = []
problems << "expected 3 diagrams, found #{figures.size}" unless figures.size == 3
problems << "<script> inside a diagram" if figures.any? { |f| f =~ /<script/i }
problems << "mermaid code block left unrendered" if html.include?("language-mermaid")
problems << "external renderer referenced" if html =~ /pele\.global|mermaid\.ink|kroki|jsdelivr|unpkg/
ids = figures.join.scan(/\sid="([^"]+)"/).flatten
dups = ids.tally.select { |_, n| n > 1 }.keys
problems << "duplicate ids: #{dups.first(5).join(', ')}" unless dups.empty?
puts "  #{ids.size} ids, all unique" if dups.empty?

abort problems.map { |p| "FAIL: #{p}" }.join("\n") unless problems.empty?
puts "OK"
