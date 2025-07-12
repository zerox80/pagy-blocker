#!/usr/bin/env python3
# Deduplication script for Pagy Blocker filter list

def deduplicate_filter_list(input_file, output_file):
    seen_rules = set()
    deduplicated_lines = []
    
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    removed_count = 0
    
    for line in lines:
        line = line.rstrip('\n\r')
        
        # If it's a filter rule (starts with ||)
        if line.startswith('||') and line.endswith('^'):
            if line in seen_rules:
                # Skip duplicate
                removed_count += 1
                print(f"Removed duplicate: {line}")
                continue
            else:
                seen_rules.add(line)
                deduplicated_lines.append(line + '\n')
        else:
            # Keep all non-rule lines (comments, headers, etc.)
            deduplicated_lines.append(line + '\n')
    
    # Write deduplicated content
    with open(output_file, 'w', encoding='utf-8') as f:
        f.writelines(deduplicated_lines)
    
    unique_rules = len(seen_rules)
    print(f"✅ Deduplication complete!")
    print(f"📊 Unique rules: {unique_rules}")
    print(f"🗑️ Removed duplicates: {removed_count}")
    print(f"💾 Saved to: {output_file}")
    
    return unique_rules

if __name__ == "__main__":
    input_file = "filter_lists/filter.txt"
    output_file = "filter_lists/filter.txt"
    
    unique_count = deduplicate_filter_list(input_file, output_file)