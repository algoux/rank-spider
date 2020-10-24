import csv
import json


def main():
    user_info = {}

    with open('CCPC2020.csv', 'r', encoding='utf-8') as file:
        rows = csv.reader(file)
        for row in rows:
            info = {
                'id': row[0],
                'organization': row[1],
                'name': row[2],
                'teamMembers': [{'name': row[3]+"(教练)"}, {'name': row[4]}, {'name': row[5]}, {'name': row[6]}],
                'official': False,
                'marker': False,
            }
            print(row)
            if row[-1] != '打星':
                info['official'] = True

            if row[-1] == '女队':
                info['marker'] = True

            user_info[row[0]] = info

    with open('CCPC2020.json', 'w', encoding='utf-8') as file:
        json.dump(user_info, file, ensure_ascii=False)


if __name__ == '__main__':
    main()



