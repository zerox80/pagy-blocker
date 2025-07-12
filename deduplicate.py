#!/usr/bin/env python3
# Deduplizierungs-Skript für Pagy Blocker Filterliste

def deduplicate_filter_list(input_file, output_file):
    seen_rules = set()
    deduplicated_lines = []
    
    with open(input_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    removed_count = 0
    
    for line in lines:
        line = line.rstrip('\n\r')
        
        # Wenn es eine Filterregel ist (beginnt mit ||)
        if line.startswith('||') and line.endswith('^'):
            if line in seen_rules:
                # Duplikat überspringen
                removed_count += 1
                print(f"Duplikat entfernt: {line}")
                continue
            else:
                seen_rules.add(line)
                deduplicated_lines.append(line + '\n')
        else:
            # Alle Nicht-Regel-Zeilen beibehalten (Kommentare, Header, etc.)
            deduplicated_lines.append(line + '\n')
    
    # Deduplizierte Inhalte schreiben
    with open(output_file, 'w', encoding='utf-8') as f:
        f.writelines(deduplicated_lines)
    
    unique_rules = len(seen_rules)
    print("Deduplizierung abgeschlossen!")
    print(f"Eindeutige Regeln: {unique_rules}")
    print(f"Entfernte Duplikate: {removed_count}")
    print(f"Gespeichert in: {output_file}")
    
    return unique_rules

if __name__ == "__main__":
    input_file = "filter_lists/filter.txt"
    output_file = "filter_lists/filter_deduped.txt"
    
    unique_count = deduplicate_filter_list(input_file, output_file)