# Proximity — Pre-Migration Audit Results
Generated: 2026-04-17T23:01:05Z

## 1. Distinct amenities values (listings.amenities[])
```
      value      
-----------------
 ac_heating
 AC/HEATING
 Bike Storage
 dishwasher
 extra_storage
 gym
 in_unit_laundry
 Laundry
 mailroom
 microwave
 oven
 Parking
 Pets Allowed
 pets_allowed
 pool
 private_parking
 refrigerator
 Rooftop
 Storage
 stove
 study_room
(21 rows)

```

## 2. Distinct utilities_included values (listings.utilities_included[])
```
  value   
----------
 Cable
 electric
 internet
 sewer
 trash
 water
 Water
(7 rows)

```

## 3. Distinct dorm tags (dorms.tags[])
```
      value       
------------------
 Central Location
 Historic
 New Building
 Quiet Floor
 Social Floor
 Study Floor
(6 rows)

```

## 4. Distinct dorm_review tags (dorm_reviews.tags[])
```
    value     
--------------
 Mixed
 Modern
 New Building
 Off-Campus
 On-Campus
 Party
 Quiet
 Social
(8 rows)

```

## 5. Distinct move_in_date formats (listings.move_in_date)
```
 move_in_date 
--------------
 2026-04-01
 2026-06-01
(2 rows)

```

## 6. Distinct place_walk_minutes keys (listings.place_walk_minutes JSONB)
```
            key             
----------------------------
 Danforth University Center
 Med Campus
 Olin Library
 Schnucks (Grocery)
 Seigle Hall
 Sumers Rec Center
 Village House
(7 rows)

```

## 7. Distinct home_type values (listings.home_type)
```
 home_type 
-----------
 apartment
 house
(2 rows)

```

## 8. Distinct user roles (users.role)
```
   role   
----------
 landlord
 student
 super
(3 rows)

```

## 9. Distinct lease_availability values (listing_units.lease_availability)
```
 lease_availability 
--------------------
 12-month
 semester
 
(3 rows)

```

## 10. Row counts (all tables)
```
      table_name       | row_count 
-----------------------+-----------
 action_logs           |         0
 amenities             |        21
 applications          |         0
 contracts             |       150
 dorm_reviews          |        46
 dorms                 |        26
 events                |       203
 listing_amenities     |       146
 listing_landlords     |         5
 listing_media         |       783
 listing_metrics_daily |        37
 listing_units         |       150
 listing_utilities     |        30
 listings              |        52
 matchmaking_responses |         2
 reviews               |         1
 schools               |         1
 testimonials          |        10
 user_contacted        |         3
 user_favorites        |         4
 users                 |        19
 utilities             |         9
(22 rows)

```

## 11. landlord_id array sizes (listings — co-landlord check)
```
 num_landlords | listing_count 
---------------+---------------
             1 |             3
             2 |             1
               |            48
(3 rows)

```

## 12. Distinct lease_structure values (listings.lease_structure)
```
 lease_structure 
-----------------
 individual
 joint
 
(3 rows)

```

